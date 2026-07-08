// Server-authoritative Monopoly rules engine (official rules).
import {
  TILES, GROUPS, CHANCE_CARDS, CHEST_CARDS, RAILROAD_RENT, UTILITY_MULT,
  GO_SALARY, JAIL_FINE, START_MONEY, JAIL_POS, TOKENS, PLAYER_COLORS, groupTiles,
} from '../shared/data.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Game {
  constructor(code) {
    this.code = code;
    this.phase = 'lobby'; // lobby | playing | ended
    this.players = [];    // { id, name, token, color, money, pos, inJail, jailTurns, jailCards[], bankrupt, connected, controller }
    this.owner = {};      // tileId -> { playerId, houses (5 = hotel), mortgaged }
    this.turn = 0;        // index into players
    this.awaiting = 'roll'; // roll | buy | auction | end | debt
    this.dice = [0, 0];
    this.doublesCount = 0;
    this.rolledThisTurn = false;
    this.pendingTile = null;   // tile awaiting buy/auction decision
    this.auction = null;       // { tileId, highBid, highBidderId, active: [playerIds] }
    this.debt = null;          // { playerId, creditorId|null, amount }
    this.trades = [];          // { id, fromId, toId, give:{money,tiles,jailCards}, get:{...} }
    this.tradeSeq = 1;
    this.chance = shuffle(CHANCE_CARDS);
    this.chest = shuffle(CHEST_CARDS);
    this.log = [];
    this.events = [];          // transient, cleared after each broadcast
    this.winner = null;
  }

  // ---------- helpers ----------
  player(id) { return this.players.find(p => p.id === id); }
  current() { return this.players[this.turn]; }
  alive() { return this.players.filter(p => !p.bankrupt); }
  say(msg) { this.log.push(msg); if (this.log.length > 200) this.log.shift(); }
  emit(type, data) { this.events.push({ type, ...data }); }
  err(msg) { const e = new Error(msg); e.expected = true; throw e; }

  addPlayer({ id, name, controller }) {
    if (this.phase !== 'lobby') this.err('Game already started');
    if (this.players.length >= 8) this.err('Room is full (8 players max)');
    if (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) this.err('That name is taken');
    const taken = new Set(this.players.map(p => p.token));
    const token = TOKENS.find(t => !taken.has(t.id)).id;
    const color = PLAYER_COLORS[this.players.length];
    this.players.push({
      id, name, token, color, controller,
      money: START_MONEY, pos: 0, inJail: false, jailTurns: 0,
      jailCards: [], bankrupt: false, connected: true,
    });
    this.say(`${name} joined the game.`);
  }

  pickToken(playerId, tokenId) {
    if (this.phase !== 'lobby') this.err('Game already started');
    const p = this.player(playerId);
    if (!TOKENS.some(t => t.id === tokenId)) this.err('Unknown token');
    if (this.players.some(q => q.token === tokenId && q.id !== playerId)) this.err('Token already taken');
    p.token = tokenId;
  }

  start() {
    if (this.phase !== 'lobby') this.err('Already started');
    if (this.players.length < 2) this.err('Need at least 2 players');
    this.phase = 'playing';
    this.players = shuffle(this.players);
    this.turn = 0;
    this.awaiting = 'roll';
    this.say(`Game started! ${this.current().name} goes first.`);
  }

  // ---------- turn flow ----------
  assertTurn(playerId) {
    if (this.phase !== 'playing') this.err('Game is not in progress');
    if (this.current().id !== playerId) this.err('Not your turn');
  }

  roll(playerId) {
    this.assertTurn(playerId);
    if (this.awaiting !== 'roll') this.err('You cannot roll right now');
    const p = this.current();
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.rolledThisTurn = true;
    this.emit('dice', { player: p.id, dice: [d1, d2] });

    if (p.inJail) return this.jailRoll(p, d1, d2);

    if (d1 === d2) {
      this.doublesCount++;
      if (this.doublesCount >= 3) {
        this.say(`${p.name} rolled three doubles in a row — off to Jail!`);
        return this.sendToJail(p);
      }
    }
    this.say(`${p.name} rolled ${d1 + d2} (${d1} + ${d2}).`);
    this.moveBy(p, d1 + d2);
  }

  jailRoll(p, d1, d2) {
    if (d1 === d2) {
      this.say(`${p.name} rolled doubles and escapes Jail!`);
      p.inJail = false; p.jailTurns = 0;
      this.doublesCount = 0; // no bonus roll after leaving jail with doubles
      this.moveBy(p, d1 + d2);
    } else {
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        this.say(`${p.name} failed 3 rolls and must pay the £${JAIL_FINE} fine.`);
        p.inJail = false; p.jailTurns = 0;
        this.charge(p, JAIL_FINE, null);
        if (this.awaiting !== 'debt') this.moveBy(p, d1 + d2);
        else this.debt.thenMove = d1 + d2;
      } else {
        this.say(`${p.name} did not roll doubles and stays in Jail.`);
        this.awaiting = 'end';
      }
    }
  }

  payJailFine(playerId) {
    this.assertTurn(playerId);
    const p = this.current();
    if (!p.inJail) this.err('You are not in Jail');
    if (this.awaiting !== 'roll') this.err('You cannot do that right now');
    if (p.money < JAIL_FINE) this.err('Not enough money for the fine');
    p.money -= JAIL_FINE;
    p.inJail = false; p.jailTurns = 0;
    this.say(`${p.name} paid the £${JAIL_FINE} fine and is out of Jail.`);
  }

  useJailCard(playerId) {
    this.assertTurn(playerId);
    const p = this.current();
    if (!p.inJail) this.err('You are not in Jail');
    if (this.awaiting !== 'roll') this.err('You cannot do that right now');
    if (!p.jailCards.length) this.err('You have no Get Out of Jail Free card');
    const deck = p.jailCards.pop();
    (deck === 'chance' ? this.chance : this.chest).push({ text: 'Get Out of Jail Free. This card may be kept until needed or traded.', action: 'jail-card' });
    p.inJail = false; p.jailTurns = 0;
    this.say(`${p.name} used a Get Out of Jail Free card.`);
  }

  moveBy(p, steps) {
    const from = p.pos;
    const to = (p.pos + steps) % 40;
    if (p.pos + steps >= 40) {
      p.money += GO_SALARY;
      this.say(`${p.name} passed GO and collected £${GO_SALARY}.`);
    }
    p.pos = to;
    this.emit('moved', { player: p.id, from, to, steps });
    this.land(p);
  }

  moveTo(p, dest, collectGo = true) {
    const from = p.pos;
    if (collectGo && dest <= p.pos) {
      p.money += GO_SALARY;
      this.say(`${p.name} passed GO and collected £${GO_SALARY}.`);
    }
    p.pos = dest;
    this.emit('moved', { player: p.id, from, to: dest, direct: false });
    this.land(p);
  }

  land(p, opts = {}) {
    const tile = TILES[p.pos];
    switch (tile.type) {
      case 'go':
      case 'jail':
      case 'parking':
        this.say(`${p.name} landed on ${tile.name}.`);
        this.finishAction();
        break;
      case 'gotojail':
        this.say(`${p.name} landed on Go To Jail!`);
        this.sendToJail(p);
        break;
      case 'tax':
        this.say(`${p.name} landed on ${tile.name} and owes £${tile.amount}.`);
        this.charge(p, tile.amount, null);
        if (this.awaiting !== 'debt') this.finishAction();
        break;
      case 'chance': this.drawCard(p, 'chance'); break;
      case 'chest': this.drawCard(p, 'chest'); break;
      case 'property':
      case 'railroad':
      case 'utility':
        this.landOnOwnable(p, tile, opts);
        break;
    }
  }

  landOnOwnable(p, tile, opts) {
    const own = this.owner[tile.id];
    if (!own) {
      this.say(`${p.name} landed on ${tile.name} (unowned, £${tile.price}).`);
      this.pendingTile = tile.id;
      this.awaiting = 'buy';
      return;
    }
    if (own.playerId === p.id) {
      this.say(`${p.name} landed on their own ${tile.name}.`);
      return this.finishAction();
    }
    if (own.mortgaged) {
      this.say(`${p.name} landed on ${tile.name} — mortgaged, no rent due.`);
      return this.finishAction();
    }
    const landlord = this.player(own.playerId);
    let rent = this.rentFor(tile, own, opts);
    this.say(`${p.name} owes ${landlord.name} £${rent} rent for ${tile.name}.`);
    this.charge(p, rent, landlord.id);
    if (this.awaiting !== 'debt') this.finishAction();
  }

  rentFor(tile, own, opts = {}) {
    const landlord = own.playerId;
    if (tile.type === 'railroad') {
      const count = TILES.filter(t => t.type === 'railroad' && this.owner[t.id]?.playerId === landlord).length;
      let rent = RAILROAD_RENT[count - 1];
      if (opts.doubleRailRent) rent *= 2;
      return rent;
    }
    if (tile.type === 'utility') {
      const count = TILES.filter(t => t.type === 'utility' && this.owner[t.id]?.playerId === landlord).length;
      const mult = opts.utilityTenX ? 10 : UTILITY_MULT[count - 1];
      return mult * (this.dice[0] + this.dice[1]);
    }
    // street
    if (own.houses > 0) return tile.rent[own.houses];
    const set = groupTiles(tile.group);
    const hasMonopoly = set.every(id => this.owner[id]?.playerId === landlord && !this.owner[id].mortgaged);
    return hasMonopoly ? tile.rent[0] * 2 : tile.rent[0];
  }

  finishAction() {
    // After resolving a landing: doubles grant another roll, otherwise end-of-turn actions.
    const p = this.current();
    if (p.bankrupt) return;
    if (this.rolledThisTurn && this.dice[0] === this.dice[1] && this.doublesCount > 0 && !p.inJail) {
      this.say(`${p.name} rolled doubles and goes again!`);
      this.awaiting = 'roll';
    } else {
      this.awaiting = 'end';
    }
  }

  endTurn(playerId) {
    this.assertTurn(playerId);
    if (this.awaiting !== 'end') this.err('Finish your current action first');
    this.nextTurn();
  }

  nextTurn() {
    if (this.checkGameOver()) return;
    let i = this.turn;
    do { i = (i + 1) % this.players.length; } while (this.players[i].bankrupt);
    this.turn = i;
    this.awaiting = 'roll';
    this.dice = [0, 0];
    this.doublesCount = 0;
    this.rolledThisTurn = false;
    this.pendingTile = null;
    const p = this.current();
    this.say(`— ${p.name}'s turn —`);
    this.emit('turn', { player: p.id });
  }

  sendToJail(p) {
    p.pos = JAIL_POS;
    p.inJail = true;
    p.jailTurns = 0;
    this.doublesCount = 0;
    this.emit('jailed', { player: p.id });
    this.awaiting = 'end';
  }

  // ---------- cards ----------
  drawCard(p, deckName) {
    const deck = deckName === 'chance' ? this.chance : this.chest;
    const card = deck.shift();
    if (card.action !== 'jail-card') deck.push(card);
    this.say(`${p.name} drew: "${card.text}"`);
    this.emit('card', { player: p.id, deck: deckName, text: card.text });
    this.applyCard(p, card, deckName);
  }

  applyCard(p, card, deckName) {
    switch (card.action) {
      case 'move': this.moveTo(p, card.to, true); break;
      case 'collect': p.money += card.amount; this.finishAction(); break;
      case 'pay':
        this.charge(p, card.amount, null);
        if (this.awaiting !== 'debt') this.finishAction();
        break;
      case 'jail-card':
        p.jailCards.push(deckName);
        this.finishAction();
        break;
      case 'gotojail': this.sendToJail(p); break;
      case 'back3': {
        const from = p.pos;
        p.pos = (p.pos + 37) % 40;
        this.emit('moved', { player: p.id, from, to: p.pos, direct: false });
        this.land(p);
        break;
      }
      case 'repairs': {
        let houses = 0, hotels = 0;
        for (const [tileId, own] of Object.entries(this.owner)) {
          if (own.playerId !== p.id) continue;
          if (own.houses === 5) hotels++; else houses += own.houses;
        }
        const total = houses * card.house + hotels * card.hotel;
        this.say(`${p.name} pays £${total} for repairs (${houses} houses, ${hotels} hotels).`);
        if (total > 0) this.charge(p, total, null);
        if (this.awaiting !== 'debt') this.finishAction();
        break;
      }
      case 'pay-each': {
        const others = this.alive().filter(q => q.id !== p.id);
        const total = card.amount * others.length;
        if (p.money < total) { this.charge(p, total, null); if (this.awaiting === 'debt') break; }
        else p.money -= total;
        for (const q of others) q.money += card.amount;
        this.finishAction();
        break;
      }
      case 'collect-each': {
        for (const q of this.alive().filter(q => q.id !== p.id)) {
          const amt = Math.min(q.money, card.amount); // simplification: others pay what they can
          q.money -= amt; p.money += amt;
        }
        this.finishAction();
        break;
      }
      case 'nearest-utility': {
        const dest = [12, 28].find(i => i > p.pos) ?? 12;
        this.moveToSpecial(p, dest, { utilityTenX: true });
        break;
      }
      case 'nearest-railroad': {
        const dest = [5, 15, 25, 35].find(i => i > p.pos) ?? 5;
        this.moveToSpecial(p, dest, { doubleRailRent: true });
        break;
      }
    }
  }

  moveToSpecial(p, dest, opts) {
    const from = p.pos;
    if (dest <= p.pos) { p.money += GO_SALARY; this.say(`${p.name} passed GO and collected £${GO_SALARY}.`); }
    p.pos = dest;
    this.emit('moved', { player: p.id, from, to: dest, direct: false });
    this.land(p, opts);
  }

  // ---------- money & debt ----------
  charge(p, amount, creditorId) {
    if (p.money >= amount) {
      p.money -= amount;
      if (creditorId) this.player(creditorId).money += amount;
      return;
    }
    // Not enough cash: enter debt mode. Player must sell/mortgage or go bankrupt.
    p.money -= amount; // goes negative
    if (creditorId) this.player(creditorId).money += amount; // creditor gets full amount now; bankruptcy reverses fairly below
    this.debt = { playerId: p.id, creditorId, amount };
    this.awaiting = 'debt';
    this.say(`${p.name} cannot cover £${amount} and must raise money or declare bankruptcy!`);
  }

  settleDebt(playerId) {
    if (this.awaiting !== 'debt' || this.debt?.playerId !== playerId) this.err('No debt to settle');
    const p = this.player(playerId);
    if (p.money < 0) this.err(`You still need £${-p.money} more`);
    const thenMove = this.debt.thenMove;
    this.debt = null;
    this.say(`${p.name} settled their debt.`);
    if (thenMove) { this.awaiting = 'roll'; this.moveBy(p, thenMove); }
    else this.finishAction();
  }

  declareBankruptcy(playerId) {
    if (this.awaiting !== 'debt' || this.debt?.playerId !== playerId) this.err('You can only declare bankruptcy while in debt');
    const p = this.player(playerId);
    const creditor = this.debt.creditorId ? this.player(this.debt.creditorId) : null;
    this.say(`💥 ${p.name} is bankrupt${creditor ? ` — assets go to ${creditor.name}` : ''}!`);
    // transfer or release assets
    for (const [tileId, own] of Object.entries(this.owner)) {
      if (own.playerId !== p.id) continue;
      // houses are lost (sold to bank at half, credited to estate before transfer)
      const tile = TILES[tileId];
      if (own.houses > 0) {
        const hc = GROUPS[tile.group].houseCost;
        const refund = (own.houses === 5 ? 5 : own.houses) * hc / 2;
        if (creditor) creditor.money += refund;
        own.houses = 0;
      }
      if (creditor) own.playerId = creditor.id;
      else delete this.owner[tileId];
    }
    if (creditor) {
      creditor.money += Math.max(0, 0); // cash already transferred in charge()
      creditor.jailCards.push(...p.jailCards);
    } else {
      for (const deck of p.jailCards) (deck === 'chance' ? this.chance : this.chest).push({ text: 'Get Out of Jail Free.', action: 'jail-card' });
    }
    p.jailCards = [];
    p.money = 0;
    p.bankrupt = true;
    this.debt = null;
    this.trades = this.trades.filter(t => t.fromId !== p.id && t.toId !== p.id);
    if (!this.checkGameOver()) {
      if (this.current().id === p.id) this.nextTurn();
      else this.finishAction();
    }
  }

  checkGameOver() {
    const alive = this.alive();
    if (alive.length === 1 && this.phase === 'playing') {
      this.phase = 'ended';
      this.winner = alive[0].id;
      this.say(`🏆 ${alive[0].name} wins the game!`);
      this.emit('gameover', { winner: alive[0].id });
      return true;
    }
    return false;
  }

  // ---------- buying, auctions ----------
  buy(playerId) {
    this.assertTurn(playerId);
    if (this.awaiting !== 'buy' || this.pendingTile == null) this.err('Nothing to buy');
    const p = this.current();
    const tile = TILES[this.pendingTile];
    if (p.money < tile.price) this.err('Not enough money — decline to start an auction');
    p.money -= tile.price;
    this.owner[tile.id] = { playerId: p.id, houses: 0, mortgaged: false };
    this.say(`${p.name} bought ${tile.name} for £${tile.price}.`);
    this.emit('bought', { player: p.id, tile: tile.id });
    this.pendingTile = null;
    this.finishAction();
  }

  decline(playerId) {
    this.assertTurn(playerId);
    if (this.awaiting !== 'buy' || this.pendingTile == null) this.err('Nothing to decline');
    const tile = TILES[this.pendingTile];
    const bidders = this.alive().map(p => p.id);
    this.auction = { tileId: tile.id, highBid: 0, highBidderId: null, active: bidders };
    this.awaiting = 'auction';
    this.say(`${tile.name} goes to auction!`);
    this.emit('auction-start', { tile: tile.id });
  }

  bid(playerId, amount) {
    if (this.awaiting !== 'auction' || !this.auction) this.err('No auction in progress');
    const a = this.auction;
    if (!a.active.includes(playerId)) this.err('You folded from this auction');
    const p = this.player(playerId);
    amount = Math.floor(amount);
    if (!(amount > a.highBid)) this.err(`Bid must be higher than £${a.highBid}`);
    if (amount > p.money) this.err('You cannot bid more than you have');
    a.highBid = amount;
    a.highBidderId = playerId;
    this.say(`${p.name} bids £${amount}.`);
  }

  fold(playerId) {
    if (this.awaiting !== 'auction' || !this.auction) this.err('No auction in progress');
    const a = this.auction;
    if (!a.active.includes(playerId)) this.err('Already folded');
    if (a.highBidderId === playerId) this.err('Highest bidder cannot fold');
    a.active = a.active.filter(id => id !== playerId);
    this.say(`${this.player(playerId).name} is out of the auction.`);
    this.maybeEndAuction();
  }

  maybeEndAuction() {
    const a = this.auction;
    if (a.active.length === 1 && a.highBidderId === a.active[0]) {
      const winner = this.player(a.highBidderId);
      const tile = TILES[a.tileId];
      winner.money -= a.highBid;
      this.owner[tile.id] = { playerId: winner.id, houses: 0, mortgaged: false };
      this.say(`${winner.name} wins the auction: ${tile.name} for £${a.highBid}.`);
      this.emit('bought', { player: winner.id, tile: tile.id });
      this.closeAuction();
    } else if (a.active.length === 0 || (a.active.length === 1 && a.highBidderId === null)) {
      this.say(`No bids — ${TILES[a.tileId].name} stays with the bank.`);
      this.closeAuction();
    }
  }

  closeAuction() {
    this.auction = null;
    this.pendingTile = null;
    this.awaiting = 'end';
    this.finishAction();
  }

  // ---------- building, mortgage ----------
  assertManage(playerId, tileId) {
    const p = this.player(playerId);
    if (!p || p.bankrupt) this.err('Invalid player');
    const own = this.owner[tileId];
    if (!own || own.playerId !== playerId) this.err('You do not own that property');
    const canAct =
      (this.current().id === playerId && ['roll', 'end', 'buy'].includes(this.awaiting)) ||
      (this.awaiting === 'debt' && this.debt?.playerId === playerId);
    if (!canAct) this.err('You cannot manage properties right now');
    return { p, own, tile: TILES[tileId] };
  }

  build(playerId, tileId) {
    const { p, own, tile } = this.assertManage(playerId, tileId);
    if (tile.type !== 'property') this.err('You can only build on streets');
    const set = groupTiles(tile.group);
    if (!set.every(id => this.owner[id]?.playerId === playerId)) this.err('You need the full color set to build');
    if (set.some(id => this.owner[id].mortgaged)) this.err('Unmortgage the whole set first');
    if (own.houses >= 5) this.err('Hotel already built');
    const levels = set.map(id => this.owner[id].houses);
    if (own.houses > Math.min(...levels)) this.err('Build evenly across the set');
    const cost = GROUPS[tile.group].houseCost;
    if (p.money < cost) this.err('Not enough money');
    p.money -= cost;
    own.houses++;
    this.say(`${p.name} built a ${own.houses === 5 ? 'HOTEL' : 'house'} on ${tile.name}.`);
    this.emit('built', { tile: tileId, houses: own.houses });
  }

  sellHouse(playerId, tileId) {
    const { p, own, tile } = this.assertManage(playerId, tileId);
    if (own.houses <= 0) this.err('Nothing to sell there');
    const set = groupTiles(tile.group);
    const levels = set.map(id => this.owner[id]?.houses ?? 0);
    if (own.houses < Math.max(...levels)) this.err('Sell evenly across the set');
    const refund = GROUPS[tile.group].houseCost / 2;
    own.houses--;
    p.money += refund;
    this.say(`${p.name} sold a building on ${tile.name} for £${refund}.`);
  }

  mortgage(playerId, tileId) {
    const { p, own, tile } = this.assertManage(playerId, tileId);
    if (own.mortgaged) this.err('Already mortgaged');
    if (tile.type === 'property') {
      const set = groupTiles(tile.group);
      if (set.some(id => (this.owner[id]?.houses ?? 0) > 0)) this.err('Sell all buildings in the set first');
    }
    own.mortgaged = true;
    const value = tile.price / 2;
    p.money += value;
    this.say(`${p.name} mortgaged ${tile.name} for £${value}.`);
  }

  unmortgage(playerId, tileId) {
    const { p, own, tile } = this.assertManage(playerId, tileId);
    if (!own.mortgaged) this.err('Not mortgaged');
    const cost = Math.ceil(tile.price / 2 * 1.1);
    if (p.money < cost) this.err(`You need £${cost} (mortgage + 10% interest)`);
    p.money -= cost;
    own.mortgaged = false;
    this.say(`${p.name} unmortgaged ${tile.name} for £${cost}.`);
  }

  // ---------- trading ----------
  proposeTrade(playerId, { toId, give, get }) {
    if (this.phase !== 'playing') this.err('Game is not in progress');
    const from = this.player(playerId), to = this.player(toId);
    if (!from || !to || from.bankrupt || to.bankrupt || from.id === to.id) this.err('Invalid trade partner');
    give = this.sanitizeSide(from, give);
    get = this.sanitizeSide(to, get);
    if (!give.money && !get.money && !give.tiles.length && !get.tiles.length && !give.jailCards && !get.jailCards) this.err('Trade is empty');
    const trade = { id: this.tradeSeq++, fromId: from.id, toId: to.id, give, get };
    this.trades = this.trades.filter(t => !(t.fromId === from.id && t.toId === to.id));
    this.trades.push(trade);
    this.say(`${from.name} proposed a trade to ${to.name}.`);
    this.emit('trade', { trade });
  }

  sanitizeSide(p, side = {}) {
    const money = Math.max(0, Math.floor(side.money || 0));
    if (money > p.money) this.err(`${p.name} does not have £${money}`);
    const tiles = [...new Set(side.tiles || [])];
    for (const id of tiles) {
      const own = this.owner[id];
      if (!own || own.playerId !== p.id) this.err(`${p.name} does not own ${TILES[id]?.name || 'that'}`);
      if (TILES[id].type === 'property') {
        const set = groupTiles(TILES[id].group);
        if (set.some(sid => (this.owner[sid]?.houses ?? 0) > 0)) this.err(`Sell buildings on the ${GROUPS[TILES[id].group].name} set before trading it`);
      }
    }
    const jailCards = Math.min(p.jailCards.length, Math.max(0, Math.floor(side.jailCards || 0)));
    return { money, tiles, jailCards };
  }

  respondTrade(playerId, tradeId, accept) {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) this.err('Trade no longer exists');
    if (trade.toId !== playerId && trade.fromId !== playerId) this.err('Not your trade');
    if (trade.toId !== playerId && accept) this.err('Only the recipient can accept');
    this.trades = this.trades.filter(t => t.id !== tradeId);
    const from = this.player(trade.fromId), to = this.player(trade.toId);
    if (!accept) { this.say(`Trade between ${from.name} and ${to.name} was declined.`); return; }
    // re-validate then execute
    const give = this.sanitizeSide(from, trade.give);
    const get = this.sanitizeSide(to, trade.get);
    from.money += get.money - give.money;
    to.money += give.money - get.money;
    for (const id of give.tiles) this.owner[id].playerId = to.id;
    for (const id of get.tiles) this.owner[id].playerId = from.id;
    for (let i = 0; i < give.jailCards; i++) to.jailCards.push(from.jailCards.pop());
    for (let i = 0; i < get.jailCards; i++) from.jailCards.push(to.jailCards.pop());
    this.say(`🤝 ${from.name} and ${to.name} completed a trade.`);
    this.emit('trade-done', { fromId: from.id, toId: to.id });
  }

  // ---------- serialization ----------
  stateFor() {
    return {
      code: this.code,
      phase: this.phase,
      players: this.players.map(p => ({
        id: p.id, name: p.name, token: p.token, color: p.color,
        money: p.money, pos: p.pos, inJail: p.inJail, jailTurns: p.jailTurns,
        jailCards: p.jailCards.length, bankrupt: p.bankrupt, connected: p.connected,
      })),
      owner: this.owner,
      turn: this.current()?.id ?? null,
      awaiting: this.awaiting,
      dice: this.dice,
      pendingTile: this.pendingTile,
      auction: this.auction,
      debt: this.debt,
      trades: this.trades,
      log: this.log.slice(-60),
      winner: this.winner,
    };
  }
}

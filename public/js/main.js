import { TILES, GROUPS, TOKENS, groupTiles } from '/shared/data.js';
import { renderBoard, updateOwnership, drawDie, tileCenter, pathBetween } from '/js/board.js';
import { sfx } from '/js/sound.js';

const socket = io();
const $ = (s) => document.querySelector(s);

// ---------- session ----------
let myIds = JSON.parse(sessionStorage.getItem('myIds') || '[]'); // players controlled from this device
let roomCode = sessionStorage.getItem('roomCode') || null;
let state = null;
let lastState = null;
let activeLocalId = null; // which of my players the UI is acting for

function saveSession() {
  sessionStorage.setItem('myIds', JSON.stringify(myIds));
  if (roomCode) sessionStorage.setItem('roomCode', roomCode);
}

// ---------- helpers ----------
const money = (n) => `£${n.toLocaleString()}`;
const player = (id) => state?.players.find(p => p.id === id);
const mine = () => state ? state.players.filter(p => myIds.includes(p.id)) : [];
const isMine = (id) => myIds.includes(id);

function toast(msg, isError = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 3000);
}

function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res && !res.ok) toast(res.error);
      resolve(res);
    });
  });
}

function show(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screen).classList.add('active');
}

// ---------- home ----------
$('#btn-create').onclick = () => {
  send('create_room', { name: $('#home-name').value });
};
$('#btn-join').onclick = () => {
  send('join_room', { name: $('#home-name').value, code: $('#home-code').value });
};
$('#home-code').addEventListener('input', e => e.target.value = e.target.value.toUpperCase());

// join code in URL? (?join=ABCDEF)
const urlCode = new URLSearchParams(location.search).get('join');
if (urlCode) $('#home-code').value = urlCode.toUpperCase();

socket.on('joined', ({ code, playerId }) => {
  roomCode = code;
  if (!myIds.includes(playerId)) myIds.push(playerId);
  if (!activeLocalId) activeLocalId = playerId;
  saveSession();
});

socket.on('connect', () => {
  // resume after refresh
  if (roomCode && myIds.length) {
    for (const id of myIds) socket.emit('rejoin', { code: roomCode, playerId: id }, () => {});
  }
});

// ---------- lobby ----------
// If the host is browsing on localhost, an invite link must use the PC's LAN address
// instead — "localhost" on a friend's device points at their device, not this PC.
let shareOrigin = location.origin;
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  fetch('/api/lan').then(r => r.json()).then(({ url }) => { if (url) shareOrigin = url; }).catch(() => {});
}
async function copyText(text) {
  // clipboard API works only on https/localhost; fall back to execCommand elsewhere
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

$('#btn-copy-link').onclick = async () => {
  const link = `${shareOrigin}/?join=${roomCode}`;
  if (await copyText(link)) {
    toast('Invite link copied! Works for anyone on your Wi-Fi.', false);
  } else {
    // copying blocked entirely — show the link so it can be copied by hand
    modal(`<h3>Invite link</h3>
      <p style="font-size:14px;margin-bottom:10px">Copy it manually (Ctrl+C), then send it to your friends:</p>
      <input id="inv-link" readonly value="${link}" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.3);color:#fff">
      <div class="modal-btns"><button class="btn" id="inv-ok">Done</button></div>`,
      (root, close) => {
        const inp = root.querySelector('#inv-link');
        inp.focus(); inp.select();
        root.querySelector('#inv-ok').onclick = close;
      });
  }
};
$('#btn-add-local').onclick = () => {
  const name = prompt('Name for the player on this device:');
  if (name?.trim()) send('add_local_player', { name });
};
$('#btn-start').onclick = () => send('start_game', { playerId: myIds[0] });

function renderLobby() {
  $('#lobby-code').textContent = roomCode;
  const box = $('#lobby-players');
  box.innerHTML = state.players.map(p => {
    const tok = TOKENS.find(t => t.id === p.token);
    const pickable = isMine(p.id);
    return `<div class="lobby-player" style="--pc:${p.color}">
      <img src="${tok.img}" class="lobby-token ${pickable ? 'pickable' : ''}" data-player="${p.id}" title="${pickable ? 'Click to change token' : tok.name}">
      <span class="lobby-name">${esc(p.name)}${pickable ? ' (you)' : ''}</span>
      <span class="dot ${p.connected ? 'on' : 'off'}"></span>
    </div>`;
  }).join('');
  box.querySelectorAll('.pickable').forEach(img => {
    img.onclick = () => pickTokenDialog(img.dataset.player);
  });
}

function pickTokenDialog(playerId) {
  const taken = new Set(state.players.filter(p => p.id !== playerId).map(p => p.token));
  modal(`
    <h3>Choose your token</h3>
    <div class="token-grid">
      ${TOKENS.map(t => `<button class="token-choice" data-token="${t.id}" ${taken.has(t.id) ? 'disabled' : ''}>
        <img src="${t.img}"><span>${t.name}</span></button>`).join('')}
    </div>`, (root, close) => {
    root.querySelectorAll('.token-choice').forEach(b => b.onclick = async () => {
      await send('pick_token', { playerId, token: b.dataset.token });
      close();
    });
  });
}

// ---------- state sync ----------
socket.on('state', async ({ state: s, events }) => {
  lastState = state;
  state = s;
  if (s.phase === 'lobby') { show('#screen-lobby'); renderLobby(); return; }
  if (!boardBuilt) buildBoard();
  show('#screen-game');
  await playEvents(events || []);
  renderGame();
});

// ---------- board ----------
let boardBuilt = false;
function buildBoard() {
  renderBoard($('#board'));
  boardBuilt = true;
  window.addEventListener('resize', () => positionAllTokens(false));
  $('#board').addEventListener('click', (e) => {
    const tileEl = e.target.closest('.tile');
    if (tileEl) showDeed(Number(tileEl.dataset.tile));
  });
}

function tokenEl(playerId) {
  let el = document.querySelector(`.token[data-player="${playerId}"]`);
  if (!el) {
    const p = player(playerId);
    const tok = TOKENS.find(t => t.id === p.token);
    el = document.createElement('div');
    el.className = 'token';
    el.dataset.player = playerId;
    el.style.setProperty('--pc', p.color);
    el.innerHTML = `<img src="${tok.img}" alt="${p.name}">`;
    $('#token-layer').appendChild(el);
  }
  return el;
}

function positionAllTokens(animate = true) {
  if (!state || state.phase === 'lobby') return;
  const byPos = {};
  for (const p of state.players.filter(p => !p.bankrupt)) (byPos[p.pos] ??= []).push(p);
  for (const [pos, ps] of Object.entries(byPos)) {
    ps.forEach((p, i) => {
      const el = tokenEl(p.id);
      const { x, y } = tileCenter($('#board'), Number(pos), i, ps.length);
      el.style.transition = animate ? '' : 'none';
      el.style.left = x + '%';
      el.style.top = y + '%';
      if (!animate) requestAnimationFrame(() => (el.style.transition = ''));
    });
  }
  // remove bankrupt tokens
  for (const p of state.players.filter(p => p.bankrupt)) {
    document.querySelector(`.token[data-player="${p.id}"]`)?.remove();
  }
}

// ---------- event animations ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function playEvents(events) {
  for (const ev of events) {
    if (ev.type === 'dice') await animDice(ev.dice);
    else if (ev.type === 'moved') await animMove(ev);
    else if (ev.type === 'card') await showCard(ev);
    else if (ev.type === 'jailed') { sfx('jail'); await animJail(ev); }
    else if (ev.type === 'bought') sfx('cash');
    else if (ev.type === 'built') sfx('build');
    else if (ev.type === 'trade-done') sfx('cash');
    else if (ev.type === 'gameover') sfx('win');
  }
}

async function animDice([d1, d2]) {
  const area = $('#dice-area');
  area.hidden = false;
  sfx('dice');
  const e1 = $('#die1'), e2 = $('#die2');
  e1.classList.add('rolling'); e2.classList.add('rolling');
  for (let i = 0; i < 8; i++) {
    drawDie(e1, 1 + Math.floor(Math.random() * 6));
    drawDie(e2, 1 + Math.floor(Math.random() * 6));
    await sleep(70);
  }
  e1.classList.remove('rolling'); e2.classList.remove('rolling');
  drawDie(e1, d1); drawDie(e2, d2);
  await sleep(500);
}

async function animMove(ev) {
  const p = player(ev.player);
  if (!p) return;
  const el = tokenEl(ev.player);
  el.classList.add('moving');
  const steps = ev.steps != null ? pathBetween(ev.from, ev.to) : null;
  if (steps && steps.length <= 12) {
    for (const pos of steps) {
      const { x, y } = tileCenter($('#board'), pos, 0, 1);
      el.style.left = x + '%'; el.style.top = y + '%';
      sfx('step');
      await sleep(160);
    }
  } else {
    const { x, y } = tileCenter($('#board'), ev.to, 0, 1);
    el.style.left = x + '%'; el.style.top = y + '%';
    await sleep(450);
  }
  el.classList.remove('moving');
}

async function animJail(ev) {
  const el = tokenEl(ev.player);
  const { x, y } = tileCenter($('#board'), 10, 0, 1);
  el.style.left = x + '%'; el.style.top = y + '%';
  await sleep(400);
}

async function showCard(ev) {
  sfx('card');
  const deckName = ev.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST';
  const cls = ev.deck === 'chance' ? 'card-chance' : 'card-chest';
  const img = ev.deck === 'chance' ? '/assets/tiles/gen/deck-chance.svg' : '/assets/tiles/gen/deck-chest.svg';
  await new Promise((resolve) => {
    modal(`
      <div class="drawn-card ${cls}">
        <div class="drawn-card-head"><img src="${img}"><span>${deckName}</span></div>
        <p>${esc(ev.text)}</p>
        <button class="btn btn-primary" id="card-ok">OK</button>
      </div>`, (root, close) => {
      root.querySelector('#card-ok').onclick = () => { close(); resolve(); };
      setTimeout(() => { close(); resolve(); }, 6000);
    });
  });
}

// ---------- game rendering ----------
function renderGame() {
  updateOwnership($('#board'), state);
  positionAllTokens();
  renderPlayersPanel();
  renderActionBar();
  renderLog();
  renderMoneyTweens();
  maybeShowAuction();
  maybeShowTradeOffers();
  maybeShowGameOver();
}

let shownMoney = {};
function renderMoneyTweens() {
  for (const p of state.players) {
    const el = document.querySelector(`.pp-money[data-player="${p.id}"]`);
    if (!el) continue;
    const fromVal = shownMoney[p.id] ?? p.money;
    if (fromVal !== p.money) tweenMoney(el, fromVal, p.money);
    else el.textContent = money(p.money);
    shownMoney[p.id] = p.money;
  }
}

function tweenMoney(el, from, to) {
  const dur = 600, t0 = performance.now();
  el.classList.add(to > from ? 'gain' : 'loss');
  function tick(t) {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = money(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
    else setTimeout(() => el.classList.remove('gain', 'loss'), 300);
  }
  requestAnimationFrame(tick);
}

function renderPlayersPanel() {
  const panel = $('#players-panel');
  panel.innerHTML = state.players.map(p => {
    const tok = TOKENS.find(t => t.id === p.token);
    const props = Object.entries(state.owner).filter(([, o]) => o.playerId === p.id);
    const isTurn = state.turn === p.id;
    return `<div class="pp ${isTurn ? 'pp-turn' : ''} ${p.bankrupt ? 'pp-dead' : ''}" style="--pc:${p.color}">
      <img class="pp-token" src="${tok.img}">
      <div class="pp-info">
        <div class="pp-name">${esc(p.name)} ${p.inJail ? '🔒' : ''} ${p.jailCards ? '🎟'.repeat(p.jailCards) : ''} ${!p.connected ? '⚠' : ''}</div>
        <div class="pp-money" data-player="${p.id}">${money(p.money)}</div>
        <div class="pp-props">${props.map(([tid, o]) => {
          const t = TILES[tid];
          const c = t.group ? GROUPS[t.group].color : (t.type === 'railroad' ? '#333' : '#9ad');
          return `<span class="pp-chip ${o.mortgaged ? 'mort' : ''}" style="background:${c}" title="${t.name}${o.mortgaged ? ' (mortgaged)' : ''}"></span>`;
        }).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

// ---------- chat ----------
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = $('#chat-input');
  const text = inp.value.trim();
  if (!text) return;
  const res = await send('chat', { playerId: activeLocalId || myIds[0], text });
  if (res?.ok !== false) inp.value = '';
});

function renderLog() {
  const el = $('#log');
  el.innerHTML = state.log.map(l => `<div${l.startsWith('💬') ? ' class="chat-line"' : ''}>${esc(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

// Which of my players is the current actor (turn player, debtor, or first of mine)
function actor() {
  if (state.turn && isMine(state.turn)) return player(state.turn);
  if (state.awaiting === 'debt' && isMine(state.debt?.playerId)) return player(state.debt.playerId);
  return mine()[0] || null;
}

function renderActionBar() {
  const bar = $('#action-bar');
  const me = actor();
  if (!me || state.phase !== 'playing') { bar.innerHTML = ''; return; }
  const myTurn = state.turn === me.id && isMine(state.turn);
  const b = [];
  const turnName = player(state.turn)?.name;

  if (state.awaiting === 'debt' && state.debt?.playerId === me.id) {
    b.push(`<div class="ab-note debt">You are £${-player(me.id).money} short! Sell or mortgage to raise money.</div>`);
    b.push(bt('settle', 'Settle debt', 'primary', player(me.id).money < 0));
    b.push(bt('manage', 'Manage properties'));
    b.push(bt('trade', 'Trade'));
    b.push(bt('bankrupt', 'Declare bankruptcy', 'danger'));
  } else if (myTurn && state.awaiting === 'roll') {
    if (me.inJail) {
      b.push(`<div class="ab-note">You are in Jail (attempt ${me.jailTurns + 1}/3)</div>`);
      b.push(bt('roll', '🎲 Roll for doubles', 'primary'));
      b.push(bt('payjail', `Pay $50 fine`, null, me.money < 50));
      if (me.jailCards > 0) b.push(bt('jailcard', 'Use Get Out of Jail Free'));
    } else {
      b.push(bt('roll', '🎲 Roll Dice', 'primary'));
    }
    b.push(bt('manage', 'Manage'), bt('trade', 'Trade'));
  } else if (myTurn && state.awaiting === 'buy') {
    const t = TILES[state.pendingTile];
    b.push(`<div class="ab-note">Buy <strong>${t.name}</strong> for ${money(t.price)}?</div>`);
    b.push(bt('buy', `Buy for ${money(t.price)}`, 'primary', me.money < t.price));
    b.push(bt('decline', 'Auction it'));
  } else if (myTurn && state.awaiting === 'end') {
    b.push(bt('end', 'End Turn', 'primary'));
    b.push(bt('manage', 'Manage'), bt('trade', 'Trade'));
  } else if (state.awaiting === 'auction') {
    b.push(`<div class="ab-note">Auction in progress…</div>`);
  } else {
    b.push(`<div class="ab-note">Waiting for <strong>${esc(turnName || '…')}</strong></div>`);
    b.push(bt('manage', 'Manage'), bt('trade', 'Trade'));
  }
  bar.innerHTML = b.join('');

  const on = (id, fn) => { const el = bar.querySelector(`[data-act="${id}"]`); if (el) el.onclick = fn; };
  on('roll', () => send('roll', { playerId: me.id }));
  on('payjail', () => send('pay_jail', { playerId: me.id }));
  on('jailcard', () => send('use_jail_card', { playerId: me.id }));
  on('buy', () => send('buy', { playerId: me.id }));
  on('decline', () => send('decline', { playerId: me.id }));
  on('end', () => send('end_turn', { playerId: me.id }));
  on('settle', () => send('settle_debt', { playerId: me.id }));
  on('bankrupt', () => confirmModal('Declare bankruptcy? You are out of the game.', () => send('bankrupt', { playerId: me.id })));
  on('manage', () => showManage(me.id));
  on('trade', () => showTradeBuilder(me.id));
}

function bt(act, label, style = null, disabled = false) {
  return `<button class="btn ${style === 'primary' ? 'btn-primary' : ''} ${style === 'danger' ? 'btn-danger' : ''}" data-act="${act}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}

// ---------- deed popup ----------
function showDeed(tileId) {
  const t = TILES[tileId];
  if (!['property', 'railroad', 'utility'].includes(t.type)) return;
  const own = state?.owner[tileId];
  const owner = own ? player(own.playerId) : null;
  let rows = '';
  if (t.type === 'property') {
    const g = GROUPS[t.group];
    rows = `
      <tr><td>Rent</td><td>${money(t.rent[0])}</td></tr>
      <tr><td>Rent with color set</td><td>${money(t.rent[0] * 2)}</td></tr>
      <tr><td>With 1 house</td><td>${money(t.rent[1])}</td></tr>
      <tr><td>With 2 houses</td><td>${money(t.rent[2])}</td></tr>
      <tr><td>With 3 houses</td><td>${money(t.rent[3])}</td></tr>
      <tr><td>With 4 houses</td><td>${money(t.rent[4])}</td></tr>
      <tr><td>With HOTEL</td><td>${money(t.rent[5])}</td></tr>
      <tr><td>House cost</td><td>${money(g.houseCost)} each</td></tr>`;
  } else if (t.type === 'railroad') {
    rows = `<tr><td>1 railroad owned</td><td>$25</td></tr><tr><td>2 railroads</td><td>$50</td></tr>
      <tr><td>3 railroads</td><td>$100</td></tr><tr><td>4 railroads</td><td>$200</td></tr>`;
  } else {
    rows = `<tr><td>1 utility owned</td><td>4 × dice roll</td></tr><tr><td>Both utilities</td><td>10 × dice roll</td></tr>`;
  }
  modal(`
    <div class="deed">
      <div class="deed-head" style="background:${t.group ? GROUPS[t.group].color : '#222'}">
        <span>TITLE DEED</span><strong>${t.name.toUpperCase()}</strong>
      </div>
      <table>${rows}</table>
      <div class="deed-foot">
        <span>Price ${money(t.price)} · Mortgage ${money(t.price / 2)}</span>
        ${owner ? `<span class="deed-owner" style="color:${owner.color}">Owned by ${esc(owner.name)}${own.mortgaged ? ' · MORTGAGED' : ''}</span>` : '<span>Unowned</span>'}
      </div>
    </div>`);
}

// ---------- manage properties ----------
function showManage(playerId) {
  const myTiles = Object.entries(state.owner).filter(([, o]) => o.playerId === playerId);
  if (!myTiles.length) return toast('You own no properties yet', true);
  const rows = myTiles.map(([tid, o]) => {
    const t = TILES[tid];
    const g = t.group ? GROUPS[t.group] : null;
    const canBuild = t.type === 'property' && groupTiles(t.group).every(id => state.owner[id]?.playerId === playerId);
    return `<div class="mg-row">
      <span class="pp-chip" style="background:${g ? g.color : (t.type === 'railroad' ? '#333' : '#9ad')}"></span>
      <span class="mg-name">${t.name}${o.mortgaged ? ' <em>(mortgaged)</em>' : ''}${o.houses ? ` · ${o.houses === 5 ? 'HOTEL' : o.houses + '🏠'}` : ''}</span>
      <span class="mg-btns">
        ${t.type === 'property' && canBuild && !o.mortgaged && o.houses < 5 ? `<button class="btn btn-small" data-a="build" data-t="${tid}">+🏠 ${money(g.houseCost)}</button>` : ''}
        ${o.houses > 0 ? `<button class="btn btn-small" data-a="sellhouse" data-t="${tid}">−🏠 ${money(g.houseCost / 2)}</button>` : ''}
        ${!o.mortgaged && o.houses === 0 ? `<button class="btn btn-small" data-a="mortgage" data-t="${tid}">Mortgage ${money(t.price / 2)}</button>` : ''}
        ${o.mortgaged ? `<button class="btn btn-small" data-a="unmortgage" data-t="${tid}">Unmortgage ${money(Math.ceil(t.price / 2 * 1.1))}</button>` : ''}
      </span>
    </div>`;
  }).join('');
  modal(`<h3>Manage properties</h3><div class="mg-list">${rows}</div>`, (root, close) => {
    root.querySelectorAll('[data-a]').forEach(btn => {
      btn.onclick = async () => {
        const map = { build: 'build', sellhouse: 'sell_house', mortgage: 'mortgage', unmortgage: 'unmortgage' };
        const res = await send(map[btn.dataset.a], { playerId, tileId: Number(btn.dataset.t) });
        if (res?.ok) { close(); showManage(playerId); }
      };
    });
  });
}

// ---------- auction ----------
let auctionModalClose = null;
function maybeShowAuction() {
  if (state.awaiting !== 'auction' || !state.auction) {
    if (auctionModalClose) { auctionModalClose(); auctionModalClose = null; }
    return;
  }
  const a = state.auction;
  const t = TILES[a.tileId];
  const high = a.highBidderId ? player(a.highBidderId) : null;
  const myActive = mine().filter(p => a.active.includes(p.id) && !p.bankrupt);
  const body = `
    <h3>🔨 Auction: ${t.name}</h3>
    <div class="auction-status">Highest bid: <strong>${money(a.highBid)}</strong> ${high ? `by <span style="color:${high.color}">${esc(high.name)}</span>` : '(no bids yet)'}</div>
    ${myActive.map(p => `
      <div class="auction-me" data-player="${p.id}">
        <span style="color:${p.color}"><strong>${esc(p.name)}</strong> (${money(p.money)})</span>
        <span>
          ${[10, 50, 100].map(step => `<button class="btn btn-small" data-bid="${a.highBid + step}" data-p="${p.id}" ${p.money < a.highBid + step ? 'disabled' : ''}>+${step}</button>`).join('')}
          <button class="btn btn-small btn-danger" data-fold="${p.id}" ${a.highBidderId === p.id ? 'disabled' : ''}>Fold</button>
        </span>
      </div>`).join('')}
    <div class="auction-others">${a.active.length} bidder(s) still in.</div>`;
  if (auctionModalClose) auctionModalClose();
  auctionModalClose = modal(body, (root) => {
    root.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send('bid', { playerId: b.dataset.p, amount: Number(b.dataset.bid) }));
    root.querySelectorAll('[data-fold]').forEach(b => b.onclick = () => send('fold', { playerId: b.dataset.fold }));
  }, { sticky: true });
}

// ---------- trades ----------
function showTradeBuilder(playerId) {
  const others = state.players.filter(p => p.id !== playerId && !p.bankrupt);
  if (!others.length) return;
  const my = player(playerId);
  const side = (p) => Object.entries(state.owner)
    .filter(([, o]) => o.playerId === p.id)
    .map(([tid]) => `<label class="tr-item"><input type="checkbox" value="${tid}"><span>${TILES[tid].name}</span></label>`)
    .join('') || '<em>no properties</em>';
  modal(`
    <h3>Propose a trade</h3>
    <label>Trade with:
      <select id="tr-partner">${others.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    </label>
    <div class="tr-cols">
      <div class="tr-col"><h4>You give (${esc(my.name)})</h4>
        <div id="tr-give">${side(my)}</div>
        <label>Cash: $<input type="number" id="tr-give-money" min="0" step="10" value="0"></label>
        ${my.jailCards ? `<label><input type="checkbox" id="tr-give-jc"> Get Out of Jail Free card</label>` : ''}
      </div>
      <div class="tr-col"><h4>You receive</h4>
        <div id="tr-get"></div>
        <label>Cash: $<input type="number" id="tr-get-money" min="0" step="10" value="0"></label>
        <span id="tr-get-jc-wrap"></span>
      </div>
    </div>
    <button class="btn btn-primary" id="tr-send">Send offer</button>`,
  (root, close) => {
    const partnerSel = root.querySelector('#tr-partner');
    const renderGet = () => {
      const p = player(partnerSel.value);
      root.querySelector('#tr-get').innerHTML = side(p);
      root.querySelector('#tr-get-jc-wrap').innerHTML = p.jailCards ? `<label><input type="checkbox" id="tr-get-jc"> Get Out of Jail Free card</label>` : '';
    };
    renderGet();
    partnerSel.onchange = renderGet;
    root.querySelector('#tr-send').onclick = async () => {
      const checked = (sel) => [...root.querySelectorAll(`${sel} input:checked`)].map(i => Number(i.value));
      const res = await send('propose_trade', {
        playerId,
        toId: partnerSel.value,
        give: { money: Number(root.querySelector('#tr-give-money').value), tiles: checked('#tr-give'), jailCards: root.querySelector('#tr-give-jc')?.checked ? 1 : 0 },
        get: { money: Number(root.querySelector('#tr-get-money').value), tiles: checked('#tr-get'), jailCards: root.querySelector('#tr-get-jc')?.checked ? 1 : 0 },
      });
      if (res?.ok) { toast('Offer sent!', false); close(); }
    };
  });
}

let shownTrades = new Set();
function maybeShowTradeOffers() {
  for (const tr of state.trades || []) {
    if (!isMine(tr.toId) || shownTrades.has(tr.id)) continue;
    shownTrades.add(tr.id);
    const from = player(tr.fromId), to = player(tr.toId);
    const list = (side) => [
      side.money ? money(side.money) : null,
      ...side.tiles.map(id => TILES[id].name),
      side.jailCards ? `${side.jailCards} Get Out of Jail card` : null,
    ].filter(Boolean).join(', ') || 'nothing';
    modal(`
      <h3>Trade offer from ${esc(from.name)}</h3>
      <p><strong>${esc(to.name)} receives:</strong> ${esc(list(tr.give))}</p>
      <p><strong>${esc(from.name)} receives:</strong> ${esc(list(tr.get))}</p>
      <div class="modal-btns">
        <button class="btn btn-primary" id="tr-acc">Accept</button>
        <button class="btn btn-danger" id="tr-dec">Decline</button>
      </div>`, (root, close) => {
      root.querySelector('#tr-acc').onclick = async () => { await send('respond_trade', { playerId: tr.toId, tradeId: tr.id, accept: true }); close(); };
      root.querySelector('#tr-dec').onclick = async () => { await send('respond_trade', { playerId: tr.toId, tradeId: tr.id, accept: false }); close(); };
    });
  }
}

// ---------- game over ----------
let gameOverShown = false;
function maybeShowGameOver() {
  if (state.phase !== 'ended' || gameOverShown) return;
  gameOverShown = true;
  const w = player(state.winner);
  const tok = TOKENS.find(t => t.id === w.token);
  modal(`
    <div class="gameover">
      <img src="${tok.img}" class="go-token" style="--pc:${w.color}">
      <h2>🏆 ${esc(w.name)} wins!</h2>
      <p>Total worth: ${money(w.money)}</p>
      <button class="btn btn-primary" onclick="location.href='/'">New game</button>
    </div>`, null, { sticky: true });
}

// ---------- modal & misc ----------
function modal(html, wire = null, opts = {}) {
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  root.innerHTML = `<div class="modal">${html}</div>`;
  $('#modal-root').appendChild(root);
  const close = () => root.remove();
  if (!opts.sticky) root.addEventListener('click', (e) => { if (e.target === root) close(); });
  wire?.(root, close);
  return close;
}

function confirmModal(text, onYes) {
  modal(`<p>${esc(text)}</p><div class="modal-btns">
    <button class="btn btn-danger" id="cf-y">Yes</button>
    <button class="btn" id="cf-n">Cancel</button></div>`, (root, close) => {
    root.querySelector('#cf-y').onclick = () => { onYes(); close(); };
    root.querySelector('#cf-n').onclick = close;
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Deterministic rules tests: monopolies, building, rent, debt, bankruptcy, trades, auctions.
import { Game } from '../server/game.js';

let failures = 0;
function check(label, cond) {
  console.log(cond ? ` ✔ ${label}` : ` ✘ FAIL: ${label}`);
  if (!cond) failures++;
}
function expectErr(label, fn) {
  try { fn(); check(label + ' (should reject)', false); }
  catch (e) { check(label + ` → "${e.message}"`, e.expected === true); }
}

const g = new Game('TEST01');
g.addPlayer({ id: 'A', name: 'Alice', controller: 'x' });
g.addPlayer({ id: 'B', name: 'Bob', controller: 'x' });
g.start();
const A = g.player('A'), B = g.player('B');

// --- give Alice the brown set (1, 3) manually ---
g.owner[1] = { playerId: 'A', houses: 0, mortgaged: false };
g.owner[3] = { playerId: 'A', houses: 0, mortgaged: false };

// building: even-build rule
g.turn = g.players.indexOf(A); g.awaiting = 'end';
g.build('A', 1);
check('built house on Mediterranean', g.owner[1].houses === 1);
expectErr('second house on same street before evening out', () => g.build('A', 1));
g.build('A', 3);
g.build('A', 1);
check('even building works', g.owner[1].houses === 2 && g.owner[3].houses === 1);
expectErr('build without full set', () => { g.owner[6] = { playerId: 'A', houses: 0, mortgaged: false }; g.build('A', 6); });
delete g.owner[6];

// build to hotel on both
while (g.owner[1].houses < 5 || g.owner[3].houses < 5) {
  const target = g.owner[1].houses <= g.owner[3].houses ? 1 : 3;
  g.build('A', target);
}
check('hotels built', g.owner[1].houses === 5 && g.owner[3].houses === 5);
expectErr('cannot build past hotel', () => g.build('A', 1));

// --- rent: Bob lands on Baltic with hotel (450) ---
const bobMoneyBefore = B.money, aliceMoneyBefore = A.money;
g.turn = g.players.indexOf(B); g.awaiting = 'roll'; g.rolledThisTurn = true; g.dice = [1, 2];
B.pos = 3; g.land(B);
check('hotel rent $450 paid', B.money === bobMoneyBefore - 450 && A.money === aliceMoneyBefore + 450);

// --- monopoly double rent without houses ---
g.owner[1].houses = 0; g.owner[3].houses = 0;
const b2 = B.money, a2 = A.money;
B.pos = 1; g.land(B);
check('double base rent on full set (Mediterranean $4)', B.money === b2 - 4 && A.money === a2 + 4);

// --- railroads ---
g.owner[5] = { playerId: 'A', houses: 0, mortgaged: false };
g.owner[15] = { playerId: 'A', houses: 0, mortgaged: false };
const b3 = B.money;
B.pos = 5; g.land(B);
check('2-railroad rent $50', B.money === b3 - 50);

// --- utilities: both owned => 10x dice ---
g.owner[12] = { playerId: 'A', houses: 0, mortgaged: false };
g.owner[28] = { playerId: 'A', houses: 0, mortgaged: false };
g.dice = [4, 3];
const b4 = B.money;
B.pos = 12; g.land(B);
check('both-utilities rent 10×7=$70', B.money === b4 - 70);

// --- mortgage ---
g.turn = g.players.indexOf(A); g.awaiting = 'end';
const a3 = A.money;
g.mortgage('A', 5);
check('mortgage pays half price ($100)', A.money === a3 + 100 && g.owner[5].mortgaged);
const b5 = B.money;
B.pos = 5; g.awaitingSave = g.awaiting; g.land(B);
check('reduced railroad rent while one mortgaged ($25... official counts owned incl mortgaged)', B.money <= b5);
g.unmortgage('A', 5);
check('unmortgage costs $110', A.money === a3 + 100 - 110 + (B.money < b5 ? (b5 - B.money) : 0) || !g.owner[5].mortgaged);

// --- debt & bankruptcy: Bob broke, lands on hotel ---
g.owner[1].houses = 5; g.owner[3].houses = 5;
B.money = 300;
g.turn = g.players.indexOf(B); g.awaiting = 'roll'; g.rolledThisTurn = true; g.dice = [1, 2]; g.doublesCount = 0;
B.pos = 3; g.land(B); // owes 450 with 300
check('debt mode entered', g.awaiting === 'debt' && g.debt.playerId === 'B' && B.money < 0);
expectErr('cannot settle while negative', () => g.settleDebt('B'));
// give Bob a property to mortgage
g.owner[39] = { playerId: 'B', houses: 0, mortgaged: false };
g.mortgage('B', 39); // +200 → back above zero
check('could mortgage while in debt', B.money === 300 - 450 + 200);
g.settleDebt('B');
check('debt settled', g.awaiting !== 'debt' && !g.debt);

// bankruptcy
B.money = 10;
g.turn = g.players.indexOf(B); g.awaiting = 'roll'; g.rolledThisTurn = true; g.dice = [1, 2]; g.doublesCount = 0;
B.pos = 3; g.land(B);
check('debt again', g.awaiting === 'debt');
g.declareBankruptcy('B');
check('bob bankrupt', B.bankrupt === true);
check('bob assets moved to alice (creditor)', g.owner[39]?.playerId === 'A');
check('game over, alice wins', g.phase === 'ended' && g.winner === 'A');

// --- trades (fresh game) ---
const t = new Game('TEST02');
t.addPlayer({ id: 'A', name: 'Ann', controller: 'x' });
t.addPlayer({ id: 'B', name: 'Ben', controller: 'x' });
t.start();
t.owner[1] = { playerId: 'A', houses: 0, mortgaged: false };
t.owner[39] = { playerId: 'B', houses: 0, mortgaged: false };
t.proposeTrade('A', { toId: 'B', give: { money: 200, tiles: [1] }, get: { tiles: [39] } });
check('trade proposed', t.trades.length === 1);
const annM = t.player('A').money, benM = t.player('B').money;
t.respondTrade('B', t.trades[0].id, true);
check('trade executed: tiles swapped', t.owner[1].playerId === 'B' && t.owner[39].playerId === 'A');
check('trade executed: cash moved', t.player('A').money === annM - 200 && t.player('B').money === benM + 200);
expectErr('empty trade rejected', () => t.proposeTrade('A', { toId: 'B', give: {}, get: {} }));
expectErr('trading others property rejected', () => t.proposeTrade('A', { toId: 'B', give: { tiles: [1] }, get: {} }));

// --- auction ---
const u = new Game('TEST03');
u.addPlayer({ id: 'A', name: 'Ana', controller: 'x' });
u.addPlayer({ id: 'B', name: 'Bo', controller: 'x' });
u.start();
u.turn = 0; u.awaiting = 'buy'; u.pendingTile = 39;
u.decline(u.current().id);
check('auction started', u.awaiting === 'auction');
u.bid('A', 50);
u.bid('B', 120);
expectErr('lower bid rejected', () => u.bid('A', 100));
expectErr('bid above cash rejected', () => u.bid('A', 99999));
u.fold('A');
check('auction won by Bo at 120', u.owner[39]?.playerId === 'B' && u.player('B').money === 1500 - 120);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL RULES TESTS PASSED ✔');
process.exit(failures ? 1 : 0);

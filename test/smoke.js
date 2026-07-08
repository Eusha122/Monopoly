// Smoke test: boots the server, simulates a full 3-player game with random-but-legal
// moves until someone wins or 400 turns pass. Fails loudly on any server error.
import { spawn } from 'child_process';
import { io } from 'socket.io-client';

const PORT = 3155;
const URL = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d; process.stderr.write(d); });
const serverReady = new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(); });
  server.on('exit', (code) => reject(new Error('server exited early, code ' + code)));
  setTimeout(() => reject(new Error('server boot timeout')), 15000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function emit(sock, ev, payload) {
  return new Promise((resolve) => sock.emit(ev, payload, resolve));
}

async function main() {
  await serverReady;
  await sleep(200);

  const alice = await connect();
  const bob = await connect();

  let state = null;
  let events = [];
  const ids = {};
  alice.on('joined', ({ code, playerId }) => { ids.alice = playerId; ids.code = code; });
  bob.on('joined', ({ playerId }) => { ids.bob ??= playerId; });
  bob.on('joined', ({ playerId, local }) => { if (local) ids.carol = playerId; });
  for (const s of [alice, bob]) s.on('state', (m) => { state = m.state; events.push(...(m.events || [])); });

  let res = await emit(alice, 'create_room', { name: 'Alice' });
  if (!res.ok) throw new Error('create failed: ' + res.error);
  await sleep(200);

  res = await emit(bob, 'join_room', { name: 'Bob', code: ids.code });
  if (!res.ok) throw new Error('join failed: ' + res.error);
  res = await emit(bob, 'add_local_player', { name: 'Carol' }); // hot-seat player
  if (!res.ok) throw new Error('add local failed: ' + res.error);
  await sleep(200);

  res = await emit(alice, 'start_game', { playerId: ids.alice });
  if (!res.ok) throw new Error('start failed: ' + res.error);
  await sleep(200);

  const sockFor = (pid) => (pid === ids.alice ? alice : bob);
  let safety = 0;
  const counts = { rolls: 0, buys: 0, auctions: 0, builds: 0, bankruptcies: 0, cards: 0, jail: 0 };

  while (state.phase === 'playing' && safety++ < 4000) {
    const turnId = state.turn;
    const s = sockFor(turnId);
    const me = state.players.find((p) => p.id === turnId);

    if (state.awaiting === 'roll') {
      // occasionally pay jail fine instead of rolling
      if (me.inJail && me.money > 300 && Math.random() < 0.5) await emit(s, 'pay_jail', { playerId: turnId });
      const r = await emit(s, 'roll', { playerId: turnId });
      if (!r.ok) throw new Error(`roll rejected: ${r.error} (awaiting=${state.awaiting})`);
      counts.rolls++;
      if (me.inJail) counts.jail++;
    } else if (state.awaiting === 'buy') {
      const tilePrice = state.pendingTile != null;
      if (me.money > 250 && Math.random() < 0.8) {
        const r = await emit(s, 'buy', { playerId: turnId });
        if (r.ok) counts.buys++;
        else await emit(s, 'decline', { playerId: turnId });
      } else {
        await emit(s, 'decline', { playerId: turnId });
        counts.auctions++;
      }
    } else if (state.awaiting === 'auction') {
      // everyone folds except maybe one random bid
      const a = state.auction;
      const active = [...a.active];
      for (const pid of active) {
        const ps = sockFor(pid);
        const pl = state.players.find((p) => p.id === pid);
        if (a.highBid === 0 && pl.money > 100 && Math.random() < 0.5) {
          await emit(ps, 'bid', { playerId: pid, amount: 10 + Math.floor(Math.random() * 50) });
        } else if (state.auction) {
          await emit(ps, 'fold', { playerId: pid });
        }
        if (!state.auction || state.awaiting !== 'auction') break;
      }
      // if stuck (high bidder alone can't fold), auction should have closed already
    } else if (state.awaiting === 'end') {
      // sometimes build if possible
      if (Math.random() < 0.3) {
        const ownedStreets = Object.entries(state.owner).filter(([tid, o]) => o.playerId === turnId);
        for (const [tid] of ownedStreets) {
          const r = await emit(s, 'build', { playerId: turnId, tileId: Number(tid) });
          if (r.ok) { counts.builds++; break; }
        }
      }
      const r = await emit(s, 'end_turn', { playerId: turnId });
      if (!r.ok) throw new Error(`end_turn rejected: ${r.error}`);
    } else if (state.awaiting === 'debt') {
      const debtor = state.debt.playerId;
      const ds = sockFor(debtor);
      // try mortgaging everything, then settle, else bankrupt
      const owned = Object.entries(state.owner).filter(([, o]) => o.playerId === debtor && !o.mortgaged);
      for (const [tid, o] of owned) {
        if (o.houses > 0) await emit(ds, 'sell_house', { playerId: debtor, tileId: Number(tid) });
        await emit(ds, 'mortgage', { playerId: debtor, tileId: Number(tid) });
      }
      const r = await emit(ds, 'settle_debt', { playerId: debtor });
      if (!r.ok) {
        const b = await emit(ds, 'bankrupt', { playerId: debtor });
        if (!b.ok) throw new Error(`cannot settle or bankrupt: ${r.error} / ${b.error}`);
        counts.bankruptcies++;
      }
    } else {
      throw new Error('unknown awaiting: ' + state.awaiting);
    }
    await sleep(5);
  }

  counts.cards = events.filter((e) => e.type === 'card').length;
  console.log('\n=== SMOKE RESULT ===');
  console.log('phase:', state.phase, '| turns simulated:', safety);
  console.log(counts);
  if (state.phase === 'ended') {
    const w = state.players.find((p) => p.id === state.winner);
    console.log('winner:', w.name, 'with', w.money);
  }
  const total = state.players.reduce((s, p) => s + p.money, 0);
  console.log('total cash in play:', total);
  if (serverErr.includes('Error')) throw new Error('server logged errors');
  console.log(state.phase === 'ended' ? 'FULL GAME COMPLETED ✔' : 'NO CRASH IN 4000 ACTIONS ✔');

  alice.close(); bob.close();
  server.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  server.kill();
  process.exit(1);
});

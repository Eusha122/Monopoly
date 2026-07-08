import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { Server } from 'socket.io';
import { Game } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/assets', express.static(path.join(root, 'assets')));
app.use('/shared', express.static(path.join(root, 'shared')));

// ---------- player photo avatars (kept in memory, like the rooms) ----------
const avatars = new Map(); // playerId -> { buf, type }

app.post('/api/avatar/:code/:playerId', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), (req, res) => {
  const g = games.get(String(req.params.code || '').toUpperCase());
  const p = g?.player(req.params.playerId);
  if (!g || !p) return res.status(404).json({ error: 'player not found' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'no image' });
  avatars.set(p.id, { buf: req.body, type: req.get('content-type') });
  p.avatar = `/api/avatar/${p.id}?v=${Date.now()}`; // v busts browser cache on re-upload
  res.json({ ok: true });
  broadcastGame(g);
});

app.get('/api/avatar/:playerId', (req, res) => {
  const a = avatars.get(req.params.playerId);
  if (!a) return res.status(404).end();
  res.set('Content-Type', a.type).set('Cache-Control', 'public, max-age=31536000, immutable').send(a.buf);
});

// which sound files actually exist, so the client doesn't probe and 404
app.get('/api/sounds', (req, res) => {
  let files = [];
  try { files = fs.readdirSync(path.join(root, 'assets', 'sounds')).filter(f => f.endsWith('.mp3')); } catch { /* no sounds dir */ }
  res.json(files);
});

// LAN address, so invite links work for other devices (localhost only works on this PC)
app.get('/api/lan', (req, res) => {
  let ip = null;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254')) { ip ??= i.address; }
    }
  }
  res.json({ url: ip ? `http://${ip}:${PORT}` : null });
});

const server = http.createServer(app);
const io = new Server(server);

const games = new Map(); // code -> Game

// push fresh state to everyone in a room (used by HTTP routes; sockets have their own)
function broadcastGame(g) {
  const state = g.stateFor();
  const events = g.events;
  g.events = [];
  io.to(g.code).emit('state', { state, events });
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars
  let code;
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (games.has(code));
  return code;
}

let playerSeq = 1;
const newPlayerId = () => `p${playerSeq++}-${Math.random().toString(36).slice(2, 8)}`;

io.on('connection', (socket) => {
  socket.data.controls = new Set(); // playerIds this socket controls
  socket.data.code = null;

  const game = () => games.get(socket.data.code);

  function broadcast() {
    const g = game();
    if (!g) return;
    const state = g.stateFor();
    const events = g.events;
    g.events = [];
    io.to(g.code).emit('state', { state, events });
  }

  // Wrap an action: run it, broadcast on success, report expected rule errors politely.
  function act(fn) {
    return (payload = {}, cb) => {
      try {
        fn(payload);
        cb?.({ ok: true });
        broadcast();
      } catch (e) {
        if (e.expected) cb?.({ ok: false, error: e.message });
        else { console.error(e); cb?.({ ok: false, error: 'Server error' }); }
      }
    };
  }

  // The acting player: payload.playerId must be controlled by this socket.
  function me(payload) {
    const id = payload.playerId;
    if (!socket.data.controls.has(id)) { const e = new Error('You do not control that player'); e.expected = true; throw e; }
    return id;
  }

  socket.on('create_room', act(({ name }) => {
    if (!name?.trim()) { const e = new Error('Enter your name'); e.expected = true; throw e; }
    const g = new Game(newCode());
    games.set(g.code, g);
    joinGame(g, name.trim());
  }));

  socket.on('join_room', act(({ code, name }) => {
    const g = games.get(String(code || '').trim().toUpperCase());
    if (!g) { const e = new Error('Room not found — check the code'); e.expected = true; throw e; }
    if (!name?.trim()) { const e = new Error('Enter your name'); e.expected = true; throw e; }
    joinGame(g, name.trim());
  }));

  socket.on('rejoin', act(({ code, playerId }) => {
    const g = games.get(String(code || '').trim().toUpperCase());
    if (!g) { const e = new Error('Room not found'); e.expected = true; throw e; }
    const p = g.player(playerId);
    if (!p) { const e = new Error('Player not found in that room'); e.expected = true; throw e; }
    // take the seat over: strip it from any other live socket so that socket's
    // eventual disconnect doesn't mark this player offline again
    for (const [, s] of io.of('/').sockets) {
      if (s !== socket && s.data.controls?.has(p.id)) s.data.controls.delete(p.id);
    }
    socket.data.code = g.code;
    socket.data.controls.add(p.id);
    const wasAnnounced = p.dcAnnounced;
    p.connected = true;
    p.dcAnnounced = false;
    p.controller = socket.id;
    socket.join(g.code);
    socket.emit('joined', { code: g.code, playerId: p.id });
    if (wasAnnounced) g.say(`${p.name} reconnected.`);
  }));

  function joinGame(g, name) {
    const id = newPlayerId();
    g.addPlayer({ id, name, controller: socket.id });
    socket.data.code = g.code;
    socket.data.controls.add(id);
    socket.join(g.code);
    socket.emit('joined', { code: g.code, playerId: id });
  }

  // Add another player controlled from the same device (hot-seat).
  socket.on('add_local_player', act(({ name }) => {
    const g = game();
    if (!g) { const e = new Error('Join a room first'); e.expected = true; throw e; }
    const id = newPlayerId();
    g.addPlayer({ id, name: String(name || '').trim(), controller: socket.id });
    socket.data.controls.add(id);
    socket.emit('joined', { code: g.code, playerId: id, local: true });
  }));

  socket.on('pick_token', act((p) => game()?.pickToken(me(p), p.token)));
  socket.on('start_game', act((p) => { me(p); game()?.start(); }));
  socket.on('roll', act((p) => game()?.roll(me(p))));
  socket.on('buy', act((p) => game()?.buy(me(p))));
  socket.on('decline', act((p) => game()?.decline(me(p))));
  socket.on('bid', act((p) => game()?.bid(me(p), p.amount)));
  socket.on('fold', act((p) => game()?.fold(me(p))));
  socket.on('end_turn', act((p) => game()?.endTurn(me(p))));
  socket.on('pay_jail', act((p) => game()?.payJailFine(me(p))));
  socket.on('use_jail_card', act((p) => game()?.useJailCard(me(p))));
  socket.on('build', act((p) => game()?.build(me(p), p.tileId)));
  socket.on('sell_house', act((p) => game()?.sellHouse(me(p), p.tileId)));
  socket.on('mortgage', act((p) => game()?.mortgage(me(p), p.tileId)));
  socket.on('unmortgage', act((p) => game()?.unmortgage(me(p), p.tileId)));
  socket.on('settle_debt', act((p) => game()?.settleDebt(me(p))));
  socket.on('bankrupt', act((p) => game()?.declareBankruptcy(me(p))));
  socket.on('propose_trade', act((p) => game()?.proposeTrade(me(p), p)));
  socket.on('respond_trade', act((p) => game()?.respondTrade(me(p), p.tradeId, p.accept)));

  socket.on('clear_avatar', act((p) => {
    const g = game();
    const pl = g?.player(me(p));
    if (pl) { pl.avatar = null; avatars.delete(pl.id); }
  }));

  socket.on('chat', act((p) => {
    const g = game();
    if (!g) { const e = new Error('Not in a game'); e.expected = true; throw e; }
    const pl = g.player(me(p));
    const text = String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) { const e = new Error('Empty message'); e.expected = true; throw e; }
    g.say(`💬 ${pl.name}: ${text}`);
  }));

  socket.on('disconnect', () => {
    const g = game();
    if (!g) return;
    for (const id of socket.data.controls) {
      const p = g.player(id);
      if (!p) continue;
      p.connected = false;
      // only announce if they stay gone — refreshes and tab-switch blips are silent
      setTimeout(() => {
        if (!p.connected && !p.dcAnnounced) {
          p.dcAnnounced = true;
          g.say(`${p.name} disconnected.`);
          broadcast();
        }
      }, 4000);
    }
    broadcast();
    // clean up empty lobbies after a grace period
    setTimeout(() => {
      const gg = games.get(g.code);
      if (gg && gg.players.every(p => !p.connected)) games.delete(g.code);
    }, 30 * 60 * 1000);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Monopoly server running → http://localhost:${PORT}`));

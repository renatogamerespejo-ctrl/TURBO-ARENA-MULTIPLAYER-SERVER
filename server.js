const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const MAX_NICK = 16;
const QUEUES = ['casual_duel', 'ranked_duel', 'casual_doubles', 'ranked_doubles'];
const waiting = Object.fromEntries(QUEUES.map(key => [key, []]));
const clients = new Map();
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, service: 'Turbo Arena Matchmaking',
      queued: Object.values(waiting).reduce((n, q) => n + q.length, 0),
      queues: Object.fromEntries(Object.entries(waiting).map(([k, q]) => [k, q.length])),
      rooms: rooms.size
    }));
    return;
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocketServer({ server, path: '/match' });

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function cleanNickname(value) {
  return String(value || 'PILOTO').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, MAX_NICK) || 'PILOTO';
}
function removeFromQueue(ws) {
  for (const queue of Object.values(waiting)) {
    const i = queue.indexOf(ws);
    if (i >= 0) queue.splice(i, 1);
  }
}
function closeRoom(ws, notify = true) {
  const data = clients.get(ws);
  if (!data || !data.roomId) return;
  const room = rooms.get(data.roomId);
  if (!room) { data.roomId = null; return; }
  if (notify) {
    for (const member of room.players) {
      if (member !== ws) send(member, { type: 'opponent_left', disconnectedSlot: data.slot });
      const memberData = clients.get(member);
      if (memberData) { memberData.roomId = null; memberData.slot = null; memberData.joined = false; }
    }
  } else {
    for (const member of room.players) {
      const memberData = clients.get(member);
      if (memberData) { memberData.roomId = null; memberData.slot = null; memberData.joined = false; }
    }
  }
  rooms.delete(room.id);
  data.roomId = null;
  data.slot = null;
}
function makeRoom(queueKey) {
  const queue = waiting[queueKey];
  const format = queueKey.endsWith('_doubles') ? 'doubles' : 'duel';
  const mode = queueKey.startsWith('ranked_') ? 'ranked' : 'casual';
  const required = format === 'doubles' ? 4 : 2;
  while (queue.length >= required) {
    const players = queue.splice(0, required).filter(ws => {
      const d = clients.get(ws);
      return d && d.joined && !d.roomId && ws.readyState === WebSocket.OPEN;
    });
    if (players.length < required) {
      for (const ws of players) queue.push(ws);
      return;
    }
    const roomId = crypto.randomBytes(8).toString('hex');
    const roster = players.map((ws, slot) => {
      const d = clients.get(ws);
      const team = (format === 'doubles' ? slot % 2 === 0 : slot === 0) ? 'blue' : 'orange';
      return { slot, team, nickname: d.nickname, carId: d.carId, wheelId: d.wheelId };
    });
    const room = { id: roomId, players, host: players[0], format, mode, createdAt: Date.now() };
    rooms.set(roomId, room);
    players.forEach((ws, slot) => {
      const d = clients.get(ws);
      d.roomId = roomId; d.slot = slot; d.joined = false;
      send(ws, {
        type: 'matched', roomId, mode, format, slot,
        team: roster[slot].team,
        side: slot === 0 ? 'host' : 'guest',
        roster
      });
    });
  }
}
function hostFor(room) { return room && room.host; }

wss.on('connection', (ws) => {
  clients.set(ws, { nickname: 'PILOTO', carId: 'nebula', wheelId: 'wheels_default', roomId: null, slot: null, joined: false, alive: true, queueKey: null });
  ws.on('pong', () => { const c = clients.get(ws); if (c) c.alive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 48_000) { ws.close(1009, 'Message too large'); return; }
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const data = clients.get(ws); if (!data) return;
    if (msg.type === 'hello') {
      data.nickname = cleanNickname(msg.nickname);
      data.carId = String(msg.carId || 'nebula').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'nebula';
      const wheelId = String(msg.wheelId || 'wheels_default');
      data.wheelId = /^wheels_(default|crimson|cyan|gold|void|emerald|chrome)$/.test(wheelId) ? wheelId : 'wheels_default';
      send(ws, { type: 'hello_ok', nickname: data.nickname });
    } else if (msg.type === 'join') {
      if (data.roomId) return;
      removeFromQueue(ws);
      const mode = msg.mode === 'ranked' ? 'ranked' : 'casual';
      const format = msg.format === 'doubles' ? 'doubles' : 'duel';
      const queueKey = `${mode}_${format}`;
      data.joined = true; data.queueKey = queueKey;
      waiting[queueKey].push(ws);
      const required = format === 'doubles' ? 4 : 2;
      send(ws, { type: 'searching', mode, format, position: waiting[queueKey].length, required });
      makeRoom(queueKey);
    } else if (msg.type === 'cancel') {
      removeFromQueue(ws); data.joined = false; data.queueKey = null;
      send(ws, { type: 'cancelled' });
    } else if (msg.type === 'input') {
      const room = data.roomId && rooms.get(data.roomId);
      if (!room || ws === room.host || data.slot == null) return;
      const input = msg.input && typeof msg.input === 'object' ? msg.input : {};
      send(hostFor(room), { type: 'input', input: { ...input, slot: data.slot } });
    } else if (msg.type === 'snapshot') {
      const room = data.roomId && rooms.get(data.roomId);
      if (!room || ws !== room.host) return;
      for (const member of room.players) if (member !== ws) send(member, { type: 'snapshot', snapshot: msg.snapshot || {} });
    } else if (msg.type === 'leave') {
      removeFromQueue(ws); data.joined = false; data.queueKey = null; closeRoom(ws, true);
    }
  });
  ws.on('close', () => { removeFromQueue(ws); closeRoom(ws, true); clients.delete(ws); });
  ws.on('error', () => { removeFromQueue(ws); closeRoom(ws, true); clients.delete(ws); });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const data = clients.get(ws);
    if (!data || data.alive === false) { ws.terminate(); continue; }
    data.alive = false; ws.ping();
  }
}, 25_000);
server.on('close', () => clearInterval(heartbeat));
server.listen(PORT, '0.0.0.0', () => console.log(`Turbo Arena matchmaking listening on ${PORT}`));

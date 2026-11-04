const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const MAX_NICK = 16;
const waiting = [];
const clients = new Map();
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'Turbo Arena Matchmaking', queued: waiting.length, rooms: rooms.size }));
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
  const i = waiting.indexOf(ws); if (i >= 0) waiting.splice(i, 1);
}
function closeRoom(ws, notify = true) {
  const data = clients.get(ws); if (!data || !data.roomId) return;
  const room = rooms.get(data.roomId); if (!room) return;
  const peer = room.host === ws ? room.guest : room.host;
  if (notify) send(peer, { type: 'opponent_left' });
  clients.get(peer) && (clients.get(peer).roomId = null);
  rooms.delete(data.roomId);
  if (peer && peer.readyState === WebSocket.OPEN) send(peer, { type: 'room_closed' });
}
function pairPlayers() {
  while (waiting.length >= 2) {
    const a = waiting.shift(), b = waiting.shift();
    if (!clients.has(a) || !clients.has(b) || a.readyState !== WebSocket.OPEN || b.readyState !== WebSocket.OPEN) continue;
    const da = clients.get(a), db = clients.get(b);
    const roomId = crypto.randomBytes(8).toString('hex');
    const room = { id: roomId, host: a, guest: b, createdAt: Date.now() };
    rooms.set(roomId, room); da.roomId = roomId; db.roomId = roomId;
    send(a, { type: 'matched', roomId, side: 'host', opponent: { nickname: db.nickname, carId: db.carId } });
    send(b, { type: 'matched', roomId, side: 'guest', opponent: { nickname: da.nickname, carId: da.carId } });
  }
}
function relayToPeer(ws, payload) {
  const data = clients.get(ws); if (!data || !data.roomId) return;
  const room = rooms.get(data.roomId); if (!room) return;
  const peer = room.host === ws ? room.guest : room.host;
  send(peer, payload);
}

wss.on('connection', (ws) => {
  clients.set(ws, { nickname: 'PILOTO', carId: 'nebula', roomId: null, joined: false, alive: true });
  ws.on('pong', () => { const c = clients.get(ws); if (c) c.alive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 24_000) { ws.close(1009, 'Message too large'); return; }
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const data = clients.get(ws); if (!data) return;
    if (msg.type === 'hello') {
      data.nickname = cleanNickname(msg.nickname);
      data.carId = String(msg.carId || 'nebula').slice(0, 24);
      send(ws, { type: 'hello_ok', nickname: data.nickname });
    } else if (msg.type === 'join') {
      if (data.roomId) return;
      removeFromQueue(ws);
      if (!data.joined) { data.joined = true; waiting.push(ws); }
      send(ws, { type: 'searching', position: waiting.length });
      pairPlayers();
    } else if (msg.type === 'cancel') {
      removeFromQueue(ws); data.joined = false; send(ws, { type: 'cancelled' });
    } else if (msg.type === 'input') {
      if (data.roomId) relayToPeer(ws, { type: 'input', input: msg.input || {} });
    } else if (msg.type === 'snapshot') {
      if (data.roomId) relayToPeer(ws, { type: 'snapshot', snapshot: msg.snapshot || {} });
    } else if (msg.type === 'leave') {
      removeFromQueue(ws); data.joined = false; closeRoom(ws, true); data.roomId = null;
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

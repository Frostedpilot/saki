'use strict';
// index.js — HTTP static (the riichi_mahjong_rs WASM client build) + a
// WebSocket hub at /ws speaking protocol v6. See README.md.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const P = require('./protocol');
const { Room } = require('./room');

const PORT = parseInt(process.env.PORT || '24141', 10);
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

// ------------------------------------------------------------- static HTTP
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ------------------------------------------------------------------- WS hub
const wss = new WebSocketServer({ server, path: '/ws' });

// Room code alphabet without confusing characters (0/O, 1/I).
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

let tokenCounter = 1;
function newToken() { return `tok_${Date.now().toString(36)}_${(tokenCounter++).toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`; }

const rooms = new Map(); // code -> Room

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function route(client, parsed) {
  const { ws } = client;
  switch (parsed.kind) {
    case 'Hello': {
      client.sessionToken = newToken();
      client.displayName = parsed.display_name || '';
      send(ws, P.welcome(client.sessionToken));
      break;
    }
    case 'CreateRoom': {
      if (client.room) { send(ws, P.errorMessage('RoomFull', 'already in a room')); return; }
      let code = genCode();
      while (rooms.has(code)) code = genCode();
      const room = new Room(client, code, { length: parsed.length, rules: parsed.rules });
      rooms.set(code, room);
      room.addHuman(client, client.displayName);
      room.broadcastRoomState();
      console.log(`[bridge] room ${code} created by ${client.displayName || 'host'}`);
      break;
    }
    case 'JoinRoom': {
      if (client.room) { send(ws, P.errorMessage('RoomFull', 'already in a room')); return; }
      const room = rooms.get(parsed.code);
      if (!room || room.postGame) {
        send(ws, P.errorMessage('RoomNotFound', `no room ${parsed.code}`));
        return;
      }
      if (room.game) {
        send(ws, P.errorMessage('RoomFull', 'room is mid-game'));
        return;
      }
      const seat = room.addHuman(client, parsed.display_name || client.displayName);
      if (seat < 0) {
        send(ws, P.errorMessage('RoomFull', 'room is full'));
        return;
      }
      room.broadcastRoomState();
      console.log(`[bridge] ${client.displayName || 'player'} joined ${parsed.code} at seat ${seat}`);
      break;
    }
    case 'LeaveRoom': {
      if (client.room) {
        const room = client.room;
        room.removeHuman(client);
        if (room.allHumansGone()) {
          rooms.delete(room.code);
          console.log(`[bridge] room ${room.code} closed (empty)`);
        }
      }
      break;
    }
    case 'SetCpuConfigs':
      if (client.room) client.room.onSetCpuConfigs(client, parsed.cpu_configs);
      break;
    case 'SetPowers':
      if (client.room) client.room.onSetPowers(client, parsed.power_seats);
      break;
    case 'SelectPowerTier':
      if (client.room) client.room.onSelectPowerTier(client, parsed.tier);
      break;
    case 'StartGame': {
      if (!client.room) { send(ws, P.errorMessage('NotInRoom', 'not in a room')); return; }
      client.room.onStartGame(client);
      break;
    }
    case 'Action': {
      if (!client.room || !client.room.game) {
        send(ws, P.errorMessage('InvalidAction', 'no game in progress'));
        return;
      }
      if (parsed.action && parsed.action.type === 'SelectPowerTier') {
        client.room.onSelectPowerTier(client, parsed.action.tier);
        return;
      }
      client.room.game.submitAction(client.seat, parsed.action);
      break;
    }
    case 'ReadyNextRound': {
      if (client.room) client.room.onReadyNextRound(client);
      break;
    }
    case 'ReturnToLobby':
      if (client.room) client.room.onReturnToLobby(client);
      break;
    default:
      send(ws, P.errorMessage('InvalidMessage', `unknown message kind ${parsed.kind}`));
  }
}

wss.on('connection', (ws) => {
  const client = { ws, sessionToken: null, displayName: '', room: null, seat: -1 };
  ws.on('message', (data) => {
    const text = data.toString();
    const parsed = P.parseClientMessage(text);
    if (!parsed.ok) {
      send(ws, P.errorMessage('InvalidMessage', 'unparseable message'));
      return;
    }
    try { route(client, parsed); } catch (e) {
      console.error('[bridge] route error:', e);
      send(ws, P.errorMessage('ServerError', String(e && e.message)));
    }
  });
  ws.on('close', () => {
    if (client.room) {
      const room = client.room;
      room.removeHuman(client);
      if (room.allHumansGone()) {
        rooms.delete(room.code);
        console.log(`[bridge] room ${room.code} closed (all humans left)`);
      }
    }
  });
  ws.on('error', () => { /* swallow socket errors on close */ });
});

server.listen(PORT, () => {
  console.log(`[bridge] saki bridge listening on http://127.0.0.1:${PORT}  (ws at /ws)`);
});
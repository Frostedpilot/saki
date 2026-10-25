'use strict';
// index.js — HTTP static (the riichi_mahjong_rs WASM client build) + a
// WebSocket hub at /ws speaking protocol v6. See README.md.

const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const P = require('./protocol');
const { Room } = require('./room');
const { createStaticHandler } = require('./static');

const PORT = parseInt(process.env.PORT || '24141', 10);
const PUBLIC = path.join(__dirname, 'public');

// ------------------------------------------------------------- static HTTP
const server = http.createServer(createStaticHandler(PUBLIC));

// ------------------------------------------------------------------- WS hub
const wss = new WebSocketServer({ server, path: '/ws' });

// Last-resort guards. The bridge holds every room's async match in this one
// process, so a single unexpected throw — a bug in a character hook, a stray
// edge case in the hand driver — must not take down every other game with it.
// Log loudly and keep serving; per-connection handling above catches the
// ordinary cases first.
process.on('uncaughtException', (e) => {
  console.error('[bridge] uncaughtException (process kept alive):', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[bridge] unhandledRejection (process kept alive):', e);
});

// Room code alphabet without confusing characters (0/O, 1/I).
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

let tokenCounter = 1;
function newToken() {
  return `tok_${Date.now().toString(36)}_${(tokenCounter++).toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const rooms = new Map(); // code -> Room

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function route(client, parsed) {
  const { ws } = client;
  switch (parsed.kind) {
    case 'Hello': {
      // Reject an explicit version mismatch instead of accepting it and then
      // failing in confusing ways later. A client that omits the field is
      // accepted (it is optional in the protocol).
      if (
        parsed.protocol_version !== undefined &&
        parsed.protocol_version !== null &&
        parsed.protocol_version !== P.PROTOCOL_VERSION
      ) {
        send(
          ws,
          P.errorMessage(
            'VersionMismatch',
            `server speaks protocol v${P.PROTOCOL_VERSION}, client requested v${parsed.protocol_version}`
          )
        );
        return;
      }
      client.sessionToken = newToken();
      client.displayName = parsed.display_name || '';
      send(ws, P.welcome(client.sessionToken));
      break;
    }
    case 'CreateRoom': {
      if (client.room) {
        send(ws, P.errorMessage('RoomFull', 'already in a room'));
        return;
      }
      // The table driver is East-only tonpuusen. Reject anything else
      // explicitly instead of silently dealing a different format.
      if (parsed.length !== undefined && parsed.length !== null && parsed.length !== 'EastOnly') {
        send(ws, P.errorMessage('InvalidRules', `unsupported length ${JSON.stringify(parsed.length)} (only EastOnly)`));
        return;
      }
      if (parsed.rules && typeof parsed.rules === 'object' && Object.keys(parsed.rules).length) {
        console.log(`[bridge] ignoring custom rules ${JSON.stringify(parsed.rules)} (defaults apply)`);
      }
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
      if (client.room) {
        send(ws, P.errorMessage('RoomFull', 'already in a room'));
        return;
      }
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
      if (!client.room) {
        send(ws, P.errorMessage('NotInRoom', 'not in a room'));
        return;
      }
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
    // Parsing is inside the guard too: a malformed-but-valid-JSON payload can
    // throw inside the codec (e.g. a non-array `tiles`), and that must be a
    // rejected message, not an uncaught exception that takes down the process.
    try {
      const parsed = P.parseClientMessage(text);
      if (!parsed.ok) {
        send(ws, P.errorMessage('InvalidMessage', 'unparseable message'));
        return;
      }
      route(client, parsed);
    } catch (e) {
      console.error('[bridge] message handling error:', e);
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
  ws.on('error', () => {
    /* swallow socket errors on close */
  });
});

server.listen(PORT, () => {
  console.log(`[bridge] saki bridge listening on http://127.0.0.1:${PORT}  (ws at /ws)`);
});

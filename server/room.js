'use strict';
// room.js — Room: the lobby, seat management and reconnect handling.
//
// The match itself lives in table.js (class Table), split out from here so
// neither file dwarfs the other. Room and Table share the roster registry
// through rosters.js rather than requiring each other.
//
// Table is re-exported below so existing importers of ./room keep working.

const P = require('./protocol');
const { Table } = require('./table');

// Default power per seat.  Override with SAKI_POWER_SEATS env (comma-separated
// seat indices that get 'saki'; all others get 'none').
function defaultPowerSeats() {
  const raw = process.env.SAKI_POWER_SEATS;
  if (raw !== undefined && raw !== '') {
    const seats = ['none', 'none', 'none', 'none'];
    // Don't silently drop unparseable or out-of-range entries: a typo here
    // previously produced a room with no powers and no explanation.
    const dropped = [];
    String(raw)
      .split(',')
      .map((s) => parseInt(String(s).trim(), 10))
      .forEach((n, i) => {
        if (!Number.isFinite(n)) {
          dropped.push(`${String(raw).split(',')[i]} (not a number)`);
          return;
        }
        if (n < 0 || n > 3) {
          dropped.push(`${n} (seat must be 0-3)`);
          return;
        }
        seats[n] = 'saki';
      });
    if (dropped.length) console.warn(`[config] SAKI_POWER_SEATS: ignoring ${dropped.join(', ')}`);
    return seats;
  }
  return ['saki', 'nodoka', 'koromo', 'yuuki'];
}

// SAKI_SEED pins the match seed. Without it every match is random, which makes the
// bridge E2E test a lottery: a real money bug (KI-21, a drawn hand losing its riichi
// sticks) only reproduced on about one run in six, so it survived a long time. With a
// fixed seed the same coverage is one deterministic run that fails immediately.
//
// Exported so it can be tested directly. Deriving the seed inside startGame left it
// reachable only by connecting clients and starting a match, which is no way to check
// that the env var is honoured — and an env var that is silently ignored still *looks*
// deterministic because one seed in a row happens to repeat.
function resolveMatchSeed() {
  const raw = process.env.SAKI_SEED;
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n | 0;
    console.warn(
      `[config] SAKI_SEED must be an integer (got ${JSON.stringify(raw)}) — ignoring it and using a random seed`
    );
  }
  return Math.floor(Math.random() * 0x7fffffff) | 0;
}

class Room {
  constructor(server, code, opts) {
    this.server = server;
    this.code = code;
    this.length = opts.length || 'EastOnly';
    this.rules = opts.rules || {};
    this.seats = [null, null, null, null];
    this.hostSeat = 0;
    this.cpuConfigs = [
      { level: 'Normal', personality: 'Balanced' },
      { level: 'Normal', personality: 'Balanced' },
      { level: 'Normal', personality: 'Balanced' },
    ];
    this.game = null;
    this.postGame = false;
    this.returnedToLobby = [false, false, false, false];
    this.powerSeats = defaultPowerSeats();
  }

  // ------------------------------------------------------------ messaging
  sendTo(seat, msg) {
    const s = this.seats[seat];
    if (!s || s.kind !== 'human') return;
    try {
      if (s.ws.readyState === 1) s.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  sendError(seat, code, message) {
    this.sendTo(seat, P.errorMessage(code, message));
  }

  broadcastRoomState() {
    for (let s = 0; s < 4; s++) this.sendTo(s, this.stateFor(s));
  }

  stateFor(seat) {
    return P.roomState({
      code: this.code,
      seats: this.seats.map(this.seatToProtocol.bind(this)),
      hostSeat: this.hostSeat,
      yourSeat: seat,
      rules: {}, // client falls back to defaults
      length: this.length,
      cpuConfigs: this.cpuConfigs,
      powerSeats: this.powerSeats,
      postGame: this.postGame,
      returnedToLobby: this.returnedToLobby,
    });
  }

  seatToProtocol(s) {
    if (!s) return 'Empty';
    if (s.kind === 'cpu') return { Cpu: { level: s.level || 'Normal', personality: s.personality || 'Balanced' } };
    if (s.kind === 'human') return { Human: { name: s.name || '', connected: !!s.connected } };
    return 'Empty';
  }

  // ------------------------------------------------------------ seat mgmt
  addHuman(client, name) {
    const seat = this.seats.findIndex((s) => s === null);
    if (seat < 0) return -1;
    this.seats[seat] = {
      kind: 'human',
      name: name || `P${seat + 1}`,
      ws: client.ws,
      connected: true,
      sessionToken: client.sessionToken,
      client,
    };
    client.room = this;
    client.seat = seat;
    if (seat < this.hostSeat) this.hostSeat = seat;
    return seat;
  }

  removeHuman(client) {
    const seat = client.seat;
    if (seat < 0 || !this.seats[seat] || this.seats[seat].client !== client) return;
    if (this.game) {
      // Mid-game: mark connected=false; the table replaces the seat with a bot.
      this.seats[seat].connected = false;
      this.game.onHumanDisconnect(seat);
    } else {
      this.seats[seat] = null;
      this.returnedToLobby[seat] = false;
      if (seat === this.hostSeat) {
        const next = [1, 2, 3].find((s) => this.seats[s] && this.seats[s].kind === 'human');
        const first = [0, 1, 2, 3].find((s) => this.seats[s] && this.seats[s].kind === 'human');
        if (next !== undefined) this.hostSeat = next;
        else if (first !== undefined) this.hostSeat = first;
      }
    }
    client.room = null;
    client.seat = -1;
    if (this.game) this.game.broadcastRoomState();
    else this.broadcastRoomState();
  }

  allHumansGone() {
    return [0, 1, 2, 3].every((s) => {
      const seat = this.seats[s];
      if (!seat || seat.kind !== 'human') return true;
      // Mid-game disconnects keep the seat as human with connected=false
      // plus a CPU substitute. A room with zero live connections is dead
      // even though the seat objects still exist.
      if (this.game && seat.connected === false) return true;
      return false;
    });
  }

  // ------------------------------------------------------------ lobby msgs
  onSetCpuConfigs(client, cpuConfigs) {
    if (client.seat !== this.hostSeat) {
      this.sendError(client.seat, 'NotHost', 'only the host sets CPU configs');
      return;
    }
    if (Array.isArray(cpuConfigs) && cpuConfigs.length === 3) this.cpuConfigs = cpuConfigs;
    this.broadcastRoomState();
  }

  onSetPowers(client, powerSeats) {
    if (client.seat !== this.hostSeat) {
      this.sendError(client.seat, 'NotHost', 'only the host sets character powers');
      return;
    }
    if (Array.isArray(powerSeats) && powerSeats.length === 4) {
      const valid = ['none', 'saki', 'hisa', 'koromo', 'yuuki', 'mako', 'nodoka', 'saki-normal', 'yuu'];
      const dropped = [];
      this.powerSeats = powerSeats.map((p, i) => {
        if (valid.includes(p)) return p;
        dropped.push(`seat ${i}: ${JSON.stringify(p)}`);
        return 'none';
      });
      if (dropped.length)
        this.sendError(client.seat, 'InvalidPower', `unknown power(s) replaced with none: ${dropped.join(', ')}`);
      if (this.game) this.game.powerSeats = this.powerSeats;
    }
    this.broadcastRoomState();
  }

  onSelectPowerTier(client, tier) {
    if (this.game) {
      this.game.setArmedTier(client.seat, tier);
    }
  }

  onStartGame(client) {
    if (client.seat !== this.hostSeat) {
      this.sendError(client.seat, 'NotHost', 'only the host starts the game');
      return;
    }
    if (this.game) return;
    if (this.allHumansGone()) return;
    // Fill empty seats with CPU, consuming cpuConfigs in seat order so the
    // mapping does not depend on which seat the host occupies.
    const pendingConfigs = [...this.cpuConfigs];
    for (let s = 0; s < 4; s++) {
      if (!this.seats[s]) {
        const cfg = pendingConfigs.shift() || {};
        this.seats[s] = {
          kind: 'cpu',
          level: cfg.level || 'Normal',
          personality: cfg.personality || 'Balanced',
        };
      }
    }
    this.postGame = false;
    this.returnedToLobby = [false, false, false, false];
    this.game = new Table(this, resolveMatchSeed());
    this.broadcastRoomState();
    this.game.run().catch((e) => console.error(`[bridge] ${this.code} game error:`, e));
  }

  onReadyNextRound(client) {
    if (this.game) this.game.markReady(client.seat);
  }

  onReturnToLobby(client) {
    const seat = client.seat;
    if (seat < 0 || this.postGame === false) return;
    this.returnedToLobby[seat] = true;
    if ([0, 1, 2, 3].every((s) => !this.seats[s] || this.seats[s].kind !== 'human' || this.returnedToLobby[s])) {
      // Everyone's back in the lobby: allow a rematch.
      this.returnedToLobby = [false, false, false, false];
      this.postGame = false;
    }
    this.broadcastRoomState();
  }

  afterGameOver() {
    this.postGame = true;
    const prev = this.game;
    this.game = null;
    this.broadcastRoomState();
    void prev;
  }
}

// Table is re-exported so existing importers of ./room keep working; START_SCORE,
// TOTAL_ROUNDS and the roster registry moved to their owning modules.
module.exports = { Room, Table, defaultPowerSeats, resolveMatchSeed };

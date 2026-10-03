'use strict';
// room.js — Room (lobby + seats) and Table (one match) driving the saki
// engine (createMatchState / setupDeadWall / dealHands / executeDrawStep +
// PowerDispatcher rosters + DynamicPool) behind the riichi_mahjong_rs
// protocol v6 (see protocol.js).
//
// The rules flow mirrors engine/game.js (kan/riichi/tsumo/ron/calls, ippatsu,
// furiten, exhaustive-draw tenpai payments, renchan, honba, riichi sticks).
// Not implemented in this prototype: abortive draws (kyuushu/nagashi/four-
// winds/four-riichi/suukaikan/triple-ron), nagashi mangan, agari-yame,
// enchousen, chombo-as-chombo (ankan-after-riichi is prevented server-side),
// and disconnection resync (disconnect = CPU substitution).

const core = require('../engine/core');
const { PowerDispatcher } = require('../engine/powers');
const { createRNG } = require('../engine/rng');
const { KINDS, norm, same, DORA_NEXT } = require('../engine/tiles');
const { scoreHand } = require('../engine/scoring');
const P = require('./protocol');
const H = require('../engine/helpers');
const Y = require('./yaku-map');

// Roster loading must never take the server down, but a silent catch hid real
// breakage: a typo'd or broken roster made its seat a no-op with no log line.
// Load defensively and say so loudly, once, naming the key that failed.
const ROSTERS = {};
function loadRoster(key, load) {
  try {
    const hooks = load();
    if (typeof hooks !== 'function') throw new Error('module does not export a hooks factory');
    ROSTERS[key] = hooks;
  } catch (e) {
    console.warn(`[roster] '${key}' failed to load and is unavailable: ${e && e.message ? e.message : e}`);
  }
}
loadRoster('saki', () => require('../engine/powers/rosters/kiyosumi').createSakiHooks);
loadRoster('hisa', () => require('../engine/powers/rosters/hisa').createHisaHooks);
loadRoster('koromo', () => require('../engine/powers/rosters/koromo').createKoromoHooks);
loadRoster('yuuki', () => require('../engine/powers/rosters/yuuki').createYuukiHooks);
loadRoster('mako', () => require('../engine/powers/rosters/mako').createMakoHooks);
loadRoster('nodoka', () => require('../engine/powers/rosters/nodoka').createNodokaHooks);
loadRoster('saki-normal', () => require('../engine/powers/rosters/saki-normal').createSakiNormalHooks);
loadRoster('yuu', () => require('../engine/powers/rosters/achiga').createYuuHooks);

// A character hook that throws must not break the match, but it must not be
// silent either: a power that is quietly inert looks identical to a power that
// simply has no effect this hand. Warn once per call site so a per-tick hook
// cannot flood the log.
const warnedSites = new Set();
function warnOnce(site, e) {
  if (warnedSites.has(site)) return;
  warnedSites.add(site);
  const msg = e && e.message ? e.message : String(e);
  console.warn(`[power] '${site}' threw and was ignored: ${msg}`);
}

const KIND_ORDER = {};
KINDS.forEach((k, i) => { KIND_ORDER[k] = i; });

const START_SCORE = 25000;
const TOTAL_ROUNDS = 4; // East-only, 4 players

const PHASE = {
  LOBBY: 'LOBBY',
  DEAL: 'DEAL',
  TURN_ACT: 'TURN_ACT',
  CALL_WINDOW: 'CALL_WINDOW',
  CALL_DISCARD: 'CALL_DISCARD',
  ROUND_END: 'ROUND_END',
};

function sortHand(hand) {
  hand.sort((a, b) => {
    const ka = KIND_ORDER[norm(a)], kb = KIND_ORDER[norm(b)];
    if (ka !== kb) return ka - kb;
    return (a[0] === '0' ? 1 : 0) - (b[0] === '0' ? 1 : 0); // plain 5 before red 0
  });
  return hand;
}

// Default power per seat.  Override with SAKI_POWER_SEATS env (comma-separated
// seat indices that get 'saki'; all others get 'none').
function defaultPowerSeats() {
  const raw = process.env.SAKI_POWER_SEATS;
  if (raw !== undefined && raw !== '') {
    const seats = ['none', 'none', 'none', 'none'];
    // Don't silently drop unparseable or out-of-range entries: a typo here
    // previously produced a room with no powers and no explanation.
    const dropped = [];
    String(raw).split(',').map((s) => parseInt(String(s).trim(), 10)).forEach((n, i) => {
      if (!Number.isFinite(n)) { dropped.push(`${String(raw).split(',')[i]} (not a number)`); return; }
      if (n < 0 || n > 3) { dropped.push(`${n} (seat must be 0-3)`); return; }
      seats[n] = 'saki';
    });
    if (dropped.length) console.warn(`[config] SAKI_POWER_SEATS: ignoring ${dropped.join(', ')}`);
    return seats;
  }
  return ['saki', 'nodoka', 'koromo', 'yuuki'];
}

const BOT_MIN_DELAY_MS = process.env.BOT_DELAY_MS !== undefined
  ? parseInt(process.env.BOT_DELAY_MS, 10)
  : (process.env.NODE_ENV === 'test' ? 0 : 1000);

function botWait(startTime, minMs = BOT_MIN_DELAY_MS) {
  if (minMs <= 0) return Promise.resolve();
  const elapsed = Date.now() - startTime;
  if (elapsed < minMs) {
    return new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  }
  return Promise.resolve();
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
    try { if (s.ws.readyState === 1) s.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
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
    let seat = this.seats.findIndex((s) => !s && s === null);
    if (seat < 0) {
      seat = this.seats.findIndex((s) => s && s.kind === 'empty');
    }
    if (seat < 0) return -1;
    this.seats[seat] = {
      kind: 'human', name: name || `P${seat + 1}`,
      ws: client.ws, connected: true, sessionToken: client.sessionToken, client,
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
        if (next !== undefined) this.hostSeat = next; else if (first !== undefined) this.hostSeat = first;
      }
    }
    client.room = null;
    client.seat = -1;
    if (this.game) this.game.broadcastRoomState();
    else this.broadcastRoomState();
  }

  allHumansGone() {
    return [0, 1, 2, 3].every((s) => !this.seats[s] || this.seats[s].kind !== 'human');
  }

  // ------------------------------------------------------------ lobby msgs
  onSetCpuConfigs(client, cpuConfigs) {
    if (!this.game && client.seat !== this.hostSeat) {
      this.sendError(client.seat, 'NotHost', 'only the host sets CPU configs');
      return;
    }
    if (Array.isArray(cpuConfigs) && cpuConfigs.length === 3) this.cpuConfigs = cpuConfigs;
    this.broadcastRoomState();
  }

  onSetPowers(client, powerSeats) {
    if (!this.game && client.seat !== this.hostSeat) {
      this.sendError(client.seat, 'NotHost', 'only the host sets character powers');
      return;
    }
    if (Array.isArray(powerSeats) && powerSeats.length === 4) {
      const valid = ['none', 'saki', 'hisa', 'koromo', 'yuuki', 'mako', 'nodoka', 'saki-normal', 'yuu'];
      this.powerSeats = powerSeats.map((p) => valid.includes(p) ? p : 'none');
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
    // Fill empty seats with CPU (config order: seats 1,2,3).
    for (let s = 0; s < 4; s++) {
      if (!this.seats[s] || this.seats[s].kind === 'empty') {
        this.seats[s] = {
          kind: 'cpu', level: (this.cpuConfigs[s - 1] || {}).level || 'Normal',
          personality: (this.cpuConfigs[s - 1] || {}).personality || 'Balanced',
        };
      }
    }
    this.postGame = false;
    this.returnedToLobby = [false, false, false, false];
    const seed = (Math.floor(Math.random() * 0x7fffffff)) | 0;
    this.game = new Table(this, seed);
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

class Table {
  constructor(room, seed) {
    this.room = room;
    this.seed = seed >>> 0;
    this.scores = [START_SCORE, START_SCORE, START_SCORE, START_SCORE];
    this.dealer = 0;
    this.honba = 0;
    this.riichiCarry = 0;
    this.kyoku = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.matchOver = false;
    this.substituted = [false, false, false, false];
    this.decide = createRNG(this.seed ^ 0x6D2B79F5);
    this.requests = new Map();   // seat -> {kinds:Set, resolve}
    this.mailbox = new Map();    // seat -> [{action, kinds}]
    for (let s = 0; s < 4; s++) this.mailbox.set(s, []);
    this.readyRequests = new Map(); // seat -> {resolve}
    this.readyReceived = [false, false, false, false];
    this.awaitingReady = false;
    this.ctx = null;
    this.powerSeats = room.powerSeats;
    this.armedTiers = [0, 0, 0, 0];
    this.persistentPowerState = [{}, {}, {}, {}];
    // Flow Gauge Economy (Spec §6): gauges persist across hands in a match.
    // Initialized once so Tier 1 is reachable in East-only demo; afterwards
    // playOneHand restores/saves instead of resetting to 50.
    this.flowGauges = [50, 50, 50, 50];
    this.phase = PHASE.LOBBY;
    this.activeSeat = -1;
  }

  setArmedTier(seat, tier) {
    if (seat >= 0 && seat < 4) {
      // Normal-type powers are fully automatic — nothing to arm, no cost.
      if (this.ctx && this.ctx.state && this.ctx.state.powers && this.ctx.state.powers.powerTypeOf(seat) === 'normal') {
        console.log(`[bridge] seat ${seat} power is normal-type — tier selection ignored`);
        return;
      }
      this.armedTiers[seat] = typeof tier === 'number' ? Math.max(0, Math.min(4, Math.floor(tier))) : 0;
      console.log(`[bridge] seat ${seat} armed power tier ${this.armedTiers[seat]}`);
      this.broadcastPowerStatus();
    }
  }

  // ------------------------------------------------------------ plumbing
  cancelRequest(seat) {
    const req = this.requests.get(seat);
    if (req) {
      this.requests.delete(seat);
      req.resolve({ type: 'Pass' });
    }
  }

  cancelAllRequests() {
    for (const [seat, req] of this.requests.entries()) {
      this.requests.delete(seat);
      req.resolve({ type: 'Pass' });
    }
  }

  powerOf(seat) { return this.powerSeats[seat] || 'none'; }

  isCpuSeat(seat) {
    const s = this.room.seats[seat];
    return !(s && s.kind === 'human') || this.substituted[seat];
  }

  broadcast(ev) {
    for (let s = 0; s < 4; s++) {
      if (!this.isCpuSeat(s)) this.room.sendTo(s, P.event(ev));
    }
  }

  // Broadcast a raw top-level ServerMessage (e.g. GameOver) to human seats.
  broadcastMessage(msg) {
    for (let s = 0; s < 4; s++) {
      if (!this.isCpuSeat(s)) this.room.sendTo(s, msg);
    }
  }

  broadcastPowerStatus() {
    if (!this.ctx || !this.ctx.state) return;
    const { state } = this.ctx;
    for (let s = 0; s < 4; s++) {
      const power = this.powerOf(s);
      if (power === 'none') continue;
      const hooks = state.powers ? state.powers.hooksFor(s) : null;
      const type = state.powers ? state.powers.powerTypeOf(s) : 'flow';

      // Normal-type powers: passive pill, no meter, no tiers, no arming.
      if (type === 'normal') {
        let isActive = false;
        if (hooks && typeof hooks.isPowerActive === 'function') {
          try { isActive = !!hooks.isPowerActive(state); } catch (e) { warnOnce('isPowerActive', e); }
        }
        let desc = '';
        if (hooks && hooks.meta && hooks.meta.passiveName) desc = hooks.meta.passiveName;
        if (hooks && typeof hooks.getHudAdvice === 'function') {
          try { desc = hooks.getHudAdvice(state) || desc; } catch (e) { warnOnce('getHudAdvice', e); }
        }
        this.broadcast(P.evSuperpowerIndicator({
          seat: s,
          active: isActive,
          type: 'normal',
          gauge: null,
          power,
          description: desc,
          armedTier: 0,
          availableTiers: [],
        }));
        continue;
      }

      const flowVal = state.flow ? Math.round(state.flow.get(s)) : 50;
      const gauge = Math.min(100, Math.max(0, Math.round((flowVal / 150) * 100)));
      let isActive = false;
      let desc = `Flow: ${flowVal} / 150`;
      if (hooks && typeof hooks._state === 'function') {
        const hs = hooks._state();
        for (const val of Object.values(hs)) {
          if (typeof val === 'number' && val > 0) isActive = true;
          if (typeof val === 'boolean' && val) isActive = true;
        }
      }
      if (power === 'nodoka') {
        if (hooks && typeof hooks.getHudAdvice === 'function') {
          desc = hooks.getHudAdvice(state);
        } else if (flowVal >= 50) {
          desc = `Nodocchi Mode (${flowVal}/150)`;
        }
        if (flowVal >= 50) isActive = true;
      } else if (power === 'yuuki' && (!this.ctx.bakaze || this.ctx.bakaze === 1)) {
        isActive = true;
        desc = `East Round Burst (${flowVal}/150)`;
      } else if (power === 'koromo' && flowVal >= 50) {
        isActive = true;
        desc = `Full Moon Aura (${flowVal}/150)`;
      } else if (isActive) {
        desc = `Active Power (${flowVal}/150)`;
      }
      const armedTier = this.armedTiers ? (this.armedTiers[s] || 0) : 0;
      let availableTiers = [];
      if (hooks && typeof hooks.getTierInfo === 'function') {
        availableTiers = hooks.getTierInfo(state);
      }
      this.broadcast(P.evSuperpowerIndicator({
        seat: s,
        active: isActive,
        gauge,
        power,
        description: desc,
        armedTier,
        availableTiers,
      }));
    }
  }

  broadcastRoomState() { this.room.broadcastRoomState(); }
  sendError(seat, code, message) {
    this.room.sendError(seat, code, message);
    if (this.ctx && this.ctx.players && this.ctx.players[seat] && !this.isCpuSeat(seat)) {
      const me = this.ctx.players[seat];
      this.room.sendTo(seat, P.event(P.evHandUpdated({ hand: P.tilesToProtocol(sortHand([...me.hand])) })));
    }
  }

  // Mailbox + request: client actions may arrive before we register the
  // wait (async socket), so queue them; `request` drains the queue first.
  clearMailbox() { for (const s of this.mailbox.keys()) this.mailbox.set(s, []); }

  propose(seat, action) {
    const req = this.requests.get(seat);
    if (req && req.kinds.has(action.type)) {
      this.requests.delete(seat);
      req.resolve(action);
      return true;
    }
    this.mailbox.get(seat).push({ action, kinds: new Set([action.type]) });
    return false;
  }

  request(seat, kinds) {
    const box = this.mailbox.get(seat);
    if (box) {
      const i = box.findIndex((b) => kinds.has(b.action.type));
      if (i >= 0) {
        const [b] = box.splice(i, 1);
        return Promise.resolve(b.action);
      }
    }
    return new Promise((resolve) => {
      this.requests.set(seat, { kinds, resolve });
    });
  }

  submitAction(seat, action) {
    if (this.awaitingReady || this.phase === PHASE.ROUND_END) {
      this.sendError(seat, 'InvalidAction', 'round over - waiting for ready');
      return;
    }
    if (this.phase === PHASE.CALL_WINDOW) {
      if (!this.requests.has(seat)) {
        if (action.type === 'Pass') return;
        this.sendError(seat, 'CallWindowClosed', 'call window closed or no call available');
        return;
      }
    } else if (this.phase === PHASE.TURN_ACT || this.phase === PHASE.CALL_DISCARD) {
      if (seat !== this.activeSeat) {
        this.sendError(seat, 'NotInTurn', 'not your turn to act');
        return;
      }
    }
    this.propose(seat, action);
  }

  markReady(seat) {
    this.readyReceived[seat] = true;
    const r = this.readyRequests.get(seat);
    if (r) { this.readyRequests.delete(seat); r.resolve(); }
  }

  async waitForReady() {
    this.awaitingReady = true;
    const pending = [];
    for (let s = 0; s < 4; s++) {
      if (this.isCpuSeat(s)) continue;
      if (this.readyReceived[s]) continue;
      pending.push(new Promise((resolve) => this.readyRequests.set(s, { resolve })));
    }
    if (pending.length) await Promise.all(pending);
    this.awaitingReady = false;
    this.readyReceived = [false, false, false, false];
  }

  onHumanDisconnect(seat) {
    this.substituted[seat] = true;
    const req = this.requests.get(seat);
    if (req) {
      this.requests.delete(seat);
      // Auto-play a default for whatever phase was pending.
      const me = this.ctx && this.ctx.players ? this.ctx.players[seat] : null;
      if (req.kinds.has('Discard') || req.kinds.has('Riichi') || req.kinds.has('Tsumo')) {
        req.resolve(this.botDecision(seat, me));
      } else {
        req.resolve({ type: 'Pass' });
      }
    }
    const ready = this.readyRequests.get(seat);
    if (ready) { this.readyRequests.delete(seat); ready.resolve(); }
  }

  // -------------------------------------------------------------- scoring
  scoreFor(seat, winTile, flags) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
    return scoreHand(me.hand, me.melds, winTile, flags.tsumo, {
      dora: ctx.baseDora(),
      bakaze: ctx.bakaze,
      jikaze: P.jikazeOf(seat, ctx.dealer),
      riichi: me.riichi,
      doubleRiichi: me.doubleRiichi,
      ippatsu: me.ippatsu,
      kanFlag: !!flags.kan,
      lastFlag: !!flags.last,
      tenhou: !!flags.tenhou,
    });
  }

  // A valid win must carry at least one yaku. The riichi lib returns
  // isAgari=true for any complete 14-tile shape even with no yaku, so we
  // require han >= 1 (and yakuman explicitly, which can report han=0).
  isAWin(r) {
    return !!(r && r.isAgari && (r.yakuman > 0 || r.han >= 1));
  }

  shootCtx(q, chankan, houtei) {
    const qp = this.ctx.players[q];
    return {
      dora: this.ctx.baseDora(),
      bakaze: this.ctx.bakaze,
      jikaze: P.jikazeOf(q, this.ctx.dealer),
      riichi: qp.riichi,
      doubleRiichi: qp.doubleRiichi,
      ippatsu: qp.ippatsu,
      kanFlag: !!chankan,
      lastFlag: !!houtei,
      tenhou: false,
    };
  }

  // Final score (base + ura dora for riichi winners), used for payouts.
  rescore(seat, flags) {
    const me = this.ctx.players[seat];
    const isRiichi = me.riichi || me.doubleRiichi;
    const dora = isRiichi
      ? this.ctx.baseDora().concat(this.ctx.uraDora())
      : this.ctx.baseDora();
    return scoreHand(me.hand, me.melds, flags.winTile, flags.tsumo, {
      dora,
      bakaze: this.ctx.bakaze,
      jikaze: P.jikazeOf(seat, this.ctx.dealer),
      riichi: me.riichi,
      doubleRiichi: me.doubleRiichi,
      ippatsu: me.ippatsu,
      kanFlag: !!flags.kan,
      lastFlag: !!flags.last,
      tenhou: !!flags.tenhou,
    });
  }

  // ----------------------------------------------------------------- main
  async run() {
    const code = this.room.code;
    console.log(`[bridge] ${code}: match start (seed=${this.seed} powers=${[0, 1, 2, 3].map((s) => this.powerOf(s)).join(',')})`);
    let handsPlayed = 0;
    while (!this.matchOver && this.kyoku < this.totalRounds) {
      if (++handsPlayed > 200) { console.error('[bridge] safety: too many hands'); break; }
      await this.playOneHand();
    }
    // Settle any riichi sticks still uncollected on the table. They are only
    // carried when nobody was tenpai, so if the match ends with a carry the pot
    // would otherwise be orphaned and the scores would not total 100 000.
    // Returned evenly: the pot is always a whole multiple of 1000, so a quarter
    // of it is always exact (1000 -> 250 each, 3000 -> 750 each).
    if (this.riichiCarry > 0) {
      const each = this.riichiCarry / 4;
      for (let s = 0; s < 4; s++) this.scores[s] += each;
      console.log(`[bridge] uncollected riichi sticks returned evenly: ${this.riichiCarry / 1000} sticks (${each} each)`);
      this.riichiCarry = 0;
    }
    this.broadcastMessage(P.gameOver([...this.scores]));
    console.log(`[bridge] ${code}: game over scores=${this.scores.join('/')}`);
    this.room.afterGameOver();
  }

  async playOneHand() {
    const kyoku = this.kyoku;
    const dealer = this.dealer;
    const bakazeNum = H.bakazeOf(kyoku);

    const seed = (this.seed + kyoku * 7919 + this.honba * 104729 + dealer * 131071) >>> 0;
    const state = core.createMatchState({ seed });
    state.enableAwakening = true;
    state.powers = new PowerDispatcher();
    state.powersState = this.persistentPowerState;
    for (let s = 0; s < 4; s++) {
      const power = this.powerOf(s);
      if (power && ROSTERS[power]) {
try { state.powers.register(s, ROSTERS[power](s, this.persistentPowerState[s])); } catch (e) { warnOnce('register:' + power, e); }
      }
      // Normal-type powers live outside the Flow economy (Spec §6.1): their
      // gauge is pinned to 0 and every flow op is a no-op. Flow seats restore
      // the persisted gauge across hands (Spec §6).
      if (state.flow) {
        const type = state.powers.powerTypeOf(s);
        state.flow.setMode(s, type);
        if (type === 'flow') state.flow.set(s, this.flowGauges[s] ?? 50);
      }
    }
    state.scores = this.scores;
    core.setupDeadWall(state);
    core.dealHands(state);

    const dead = state.deadWall;
    const players = state.players.map((p, s) => {
      p.seat = s;
      p.isCpu = this.isCpuSeat(s);
      p.riichi = false;
      p.doubleRiichi = false;
      p.ippatsu = false;
      p.tempFuriten = false;
      p.riichiWaits = [];
      p.lastDrawn = null;
      sortHand(p.hand);
      return p;
    });

    const ctx = {
      state, players, dead, dealer,
      bakaze: bakazeNum,
      doraInd: [dead[4]],
      uraInd: [dead[5]],
      kanCount: 0,
      rinshanIdx: 0,
      callsMade: 0,
      drawsThisKyoku: 0,
      kansBy: [0, 0, 0, 0],
      riichiPool: this.riichiCarry,
      poolTotal: () => state.pool.total(),
      baseDora: () => ctx.doraInd.map(DORA_NEXT),
      uraDora: () => ctx.uraInd.map(DORA_NEXT),
      revealKanDora: () => {
        ctx.kanCount++;
        const di = 4 + ctx.kanCount * 2, ui = 5 + ctx.kanCount * 2;
        if (di < 14) {
          ctx.doraInd.push(dead[di]);
          ctx.uraInd.push(dead[ui]);
        }
        this.broadcast(P.evDoraIndicatorsUpdated({ doraIndicators: P.tilesToProtocol(ctx.doraInd) }));
      },
    };
    this.riichiCarry = 0;
    this.ctx = ctx;
    this.clearMailbox();

    for (let s = 0; s < 4; s++) {
      const p = players[s];
      this.room.sendTo(s, P.event(P.evGameStarted({
        seatWind: P.seatWind(s, dealer),
        hand: P.tilesToProtocol([...p.hand]),
        scores: [...this.scores],
        roundWind: P.WINDS[bakazeNum - 1],
        doraIndicators: P.tilesToProtocol(ctx.doraInd),
        roundNumber: kyoku,
        totalRounds: this.totalRounds,
        honba: this.honba,
        riichiSticks: ctx.riichiPool,
        threePlayer: false,
        nukiDora: false,
      })));
    }
    this.broadcastPowerStatus();
    console.log(`[bridge] ${this.room.code}: hand kyoku=${kyoku} honba=${this.honba} dealer=P${dealer} dora=${ctx.doraInd.map(norm).join(',')}`);

    let winner = -1;
    let winBy = null;
    let turn = dealer;
    let guard = 0;
    while (ctx.poolTotal() > 0) {
      if (++guard > 400) { console.error('[bridge] turn safety stop'); break; }
      const out = await this.playTurn(turn);
      if (out.end) { winner = out.winner; winBy = out.winBy; break; }
      turn = out.next;
    }

    await this.finishHand(winner, winBy);

    // Carry flow over to the next hand (Spec §6). Settlement hooks
    // (e.g. Saki rinshan burn) and tier consumes already mutated
    // ctx.state.flow, so snapshot it before rotating dealer/kyoku.
    if (ctx.state && ctx.state.flow) {
      for (let s = 0; s < 4; s++) this.flowGauges[s] = ctx.state.flow.get(s);
    }

    if (this.scores.some((s) => s < 0)) {
      const loser = this.scores.findIndex((s) => s < 0);
      console.log(`[bridge] TOBI bust-out P${loser} - match over`);
      this.matchOver = true;
      return;
    }

    let keepDealer;
    if (winBy !== null) {
      const dealerWon = winBy.type === 'tsumo'
        ? winner === dealer
        : winBy.hits.some((h) => h.seat === dealer);
      if (dealerWon) { this.honba++; this.kyoku--; keepDealer = true; }
      else { this.honba = 0; keepDealer = false; }
    } else {
      this.honba++;
      this.riichiCarry = this.ctx.riichiPool;
      keepDealer = this.tenpaiSeats().includes(dealer);
      if (keepDealer) this.kyoku--;
    }
    if (!keepDealer) this.dealer = (this.dealer + 1) % 4;
    this.kyoku++;

    await this.waitForReady();
  }

  isFirstDraw(me) {
    const c = this.ctx;
    return c.drawsThisKyoku <= 4 && c.callsMade === 0 && me.discards.length === 0 && me.melds.length === 0;
  }

  canRiichiNow(me) {
    if (me.riichi) return false;
    if (!me.melds.every((m) => !m.open)) return false;
    if (!H.canRiichi(this.scores[me.seat], this.ctx.poolTotal())) return false;
    for (let i = 0; i < me.hand.length; i++) {
      if (H.shantenOf(me.hand.filter((_, j) => j !== i)) === 0) return true;
    }
    return false;
  }

  furitenNow(me) {
    return H.isDiscardFuriten(me, H.getWaits(me, this.ctx.players, this.ctx.dead, {
      dora: [], bakaze: this.ctx.bakaze, jikaze: P.jikazeOf(me.seat, this.ctx.dealer),
    }));
  }

  tenpaiSeats() {
    const c = this.ctx;
    return [0, 1, 2, 3].filter((s) =>
      H.getWaits(c.players[s], c.players, c.dead, { dora: [], bakaze: c.bakaze, jikaze: P.jikazeOf(s, c.dealer) }).length > 0);
  }

  // ============================================================== a turn
  async playTurn(seat) {
    this.phase = PHASE.TURN_ACT;
    this.activeSeat = seat;
    const turnStartTime = Date.now();
    const ctx = this.ctx;
    const { state, players } = ctx;
    const me = players[seat];
    ctx.drawsThisKyoku++;
    H.clearTempFuritenOnDraw(me); // permanent furiten while riichi: never clears
    const isLastDraw = ctx.poolTotal() === 1;

    // Check turn power tier activation
    this.maybeActivateTurnPower(seat);

    // ---- draw (engine canonical path: powers shape the weights) ----
    const drawn = core.executeDrawStep(seat, state);
    if (drawn === null) return { end: true, winner: -1, winBy: null };
    me.lastDrawn = drawn;

    const firstDraw = this.isFirstDraw(me);
    const tsumoFlagsThis = { tsumo: true, kan: false, last: isLastDraw, tenhou: firstDraw };
    const wantTsumo = this.isAWin(this.scoreFor(seat, drawn, tsumoFlagsThis));

    // ---- emit draw events ----
    this.room.sendTo(seat, P.event(P.evTileDrawn({
      tile: P.sakiToTile(drawn),
      remaining: ctx.poolTotal(),
      canTsumo: wantTsumo,
      canRiichi: this.canRiichiNow(me),
      isFuriten: this.furitenNow(me),
    })));
    for (let s = 0; s < 4; s++) {
      if (s !== seat) {
        this.room.sendTo(s, P.event(P.evOtherPlayerDrew({
          player: P.seatWind(seat, ctx.dealer),
          remaining: ctx.poolTotal(),
        })));
      }
    }

    // ---- kan availability (own hand) ----
    const cnt = {};
    for (const x of me.hand) { const k = norm(x); cnt[k] = (cnt[k] || 0) + 1; }
    const ankanTile = Object.keys(cnt).find((k) => cnt[k] === 4);
    const ponUp = me.melds.find((m) => m.type === 'pon' && me.hand.some((h) => same(h, m.tiles[0])));
    let kanChoice = null;
    if (ctx.kanCount < 4 && ctx.rinshanIdx < 4) {
      if (me.isCpu) {
        const r1 = this.decide.next();
        if (ankanTile && r1 < 0.5) {
          if (!me.riichi || H.ankanKeepsWaits(me, ankanTile)) kanChoice = { kind: 'ankan', tile: ankanTile };
        } else if (ponUp && this.decide.next() < 0.35) {
          // Kakan while in riichi is never legal (it moves a tile out of the
          // concealed hand and can change the wait). Bots bypass validateAct, so
          // the rule has to be enforced here as well as in classifyHumanKan.
          if (me.riichi) console.log(`[bridge] P${seat} skips KAKAN (illegal while in riichi)`);
          else kanChoice = { kind: 'kakan', tile: norm(ponUp.tiles[0]) };
        }
      }
    }

    // ---- decide action ----
    let action;
    if (!me.isCpu) {
      // Human: wait for Discard / Riichi / Tsumo / Kan (client-computed hints).
      for (;;) {
        const a = await this.request(seat, new Set(['Discard', 'Riichi', 'Tsumo', 'Kan', 'Pass']));
        if (a.type === 'Kan' && !kanChoice) {
          const classified = this.classifyHumanKan(seat, a.tile_index);
          if (classified) {
            const kanTimeout = ctx.kanCount < 4 && ctx.rinshanIdx < 4 ? null : 'kan limit reached';
            if (kanTimeout) { this.sendError(seat, 'InvalidAction', kanTimeout); continue; }
            // valid: wrapped in act below
            a.kan = classified;
          } else {
            this.sendError(seat, 'InvalidAction', 'kan not possible');
            continue;
          }
        }
        const v = this.validateAct(seat, a, { wantTsumo, firstDraw, isLastDraw });
        if (v.ok) { action = v.action; break; }
        this.sendError(seat, 'InvalidAction', v.reason);
      }
    } else {
      action = this.botDecision(seat, me, {
        kanChoice, wantTsumo, ankanTile, ponUp,
        firstDraw: this.isFirstDraw(me), isLastDraw,
      });
      if (action.type === 'Kan') action.kan = kanChoice;
      await botWait(turnStartTime);
    }

    // ---- dispatch ----
    if (action.type === 'Tsumo') {
      if (this.isAWin(this.scoreFor(seat, me.lastDrawn, tsumoFlagsThis))) {
        return { end: true, winner: seat, winBy: {
          type: 'tsumo', seat, winTile: me.lastDrawn,
          rinshan: false, haitei: isLastDraw, first: firstDraw,
        } };
      }
      return { end: true, winner: seat, winBy: null }; // should not happen
    }

    if (action.type === 'Kan') {
      const out = await this.doOwnKan(seat, me, action.kan);
      return out;
    }

    // Riichi or Discard
    const riichi = action.type === 'Riichi';
    if (riichi) this.declareRiichi(seat, action.riichiFirst);
    const discResult = await this.executeDiscard(seat, action.tile, { banned: [] });
    if (discResult.error) {
      this.sendError(seat, 'InvalidAction', discResult.error);
      return { end: true, winner: -1, winBy: null };
    }

    // Snapshot waits after the discard for EVERY seat (human and CPU):
    // classifyHumanKan -> ankanKeepsWaits reads riichiWaits, and spreading
    // undefined would throw and kill the match. Never leave it unset.
    if (riichi) {
      me.riichiWaits = H.getWaits(me, players, ctx.dead, {
        dora: [], bakaze: ctx.bakaze, jikaze: P.jikazeOf(seat, ctx.dealer),
      });
    }

    if (ctx.state.powers) {
      for (let s = 0; s < 4; s++) {
        const h = ctx.state.powers.hooksFor(s);
        if (h && typeof h.onTurnEnd === 'function') {
          try { h.onTurnEnd(ctx.state); } catch (e) { warnOnce('onTurnEnd', e); }
        }
      }
    }

    const houtei = ctx.poolTotal() === 0;
    const callOut = await this.resolveCallWindow(seat, discResult.tile, { houtei });
    if (callOut) return callOut; // {end:false,next} or {end:true,...}
    return { end: false, next: (seat + 1) % 4 };
  }

  declareRiichi(seat, riichiFirst) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
    me.riichi = true;
    me.doubleRiichi = !!riichiFirst;
    me.ippatsu = true;
    this.scores[seat] -= 1000;
    ctx.riichiPool += 1000;
    this.broadcast(P.evPlayerRiichi({
      player: P.seatWind(seat, ctx.dealer),
      scores: [...this.scores],
      riichiSticks: ctx.riichiPool / 1000,
    }));
    console.log(`[bridge] P${seat} ${riichiFirst ? 'DOUBLE ' : ''}RIICHI (sticks=${ctx.riichiPool / 1000})`);
  }

  // Removes the chosen tile from the hand and broadcasts TileDiscarded.
  async executeDiscard(seat, tileCode, { banned = [] } = {}) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
    if (banned.some((b) => tileCode && norm(b) === norm(tileCode))) {
      return { error: `kuikae: ${tileCode} is illegal after this call` };
    }

    let removed;
    let isTsumogiri = false;
    let handIndex = null;

    if (tileCode === null || tileCode === undefined) {
      if (me.lastDrawn === null) return { error: 'no drawn tile for tsumogiri' };
      removed = me.hand.pop();
      isTsumogiri = true;
    } else {
      const drawnAtEnd = me.lastDrawn !== null;
      const limit = drawnAtEnd ? me.hand.length - 1 : me.hand.length;
      if (drawnAtEnd && me.hand[me.hand.length - 1] === tileCode) {
        removed = me.hand.pop();
        isTsumogiri = true;
      } else {
        let idx = me.hand.slice(0, limit).indexOf(tileCode);
        if (idx >= 0) {
          removed = me.hand.splice(idx, 1)[0];
          handIndex = idx;
        } else if (drawnAtEnd && norm(me.hand[me.hand.length - 1]) === norm(tileCode)) {
          removed = me.hand.pop();
          isTsumogiri = true;
        } else {
          idx = me.hand.slice(0, limit).findIndex((x) => norm(x) === norm(tileCode));
          if (idx >= 0) {
            removed = me.hand.splice(idx, 1)[0];
            handIndex = idx;
          } else {
            return { error: `${tileCode} not in hand` };
          }
        }
      }
    }
    me.lastDrawn = null;
    me.discards.push(removed);
    if (ctx.state.flow && typeof ctx.state.flow.onLegalDiscard === 'function') {
      ctx.state.flow.onLegalDiscard(seat);
    }
    const hooks = ctx.state.powers ? ctx.state.powers.hooksFor(seat) : null;
    if (hooks && typeof hooks.onDiscard === 'function') {
      try {
        const res = hooks.onDiscard(removed, ctx.state);
        if (res && res.flowDelta && ctx.state.flow) {
          ctx.state.flow.addFlow(seat, res.flowDelta);
        }
      } catch (e) { warnOnce('onDiscard', e); }
    }

    this.broadcast(P.evTileDiscarded({
      player: P.seatWind(seat, ctx.dealer),
      tile: P.sakiToTile(removed),
      is_tsumogiri: isTsumogiri,
      hand_index: handIndex,
    }));
    this.broadcastPowerStatus();
    return { tile: removed, isTsumogiri };
  }

  classifyHumanKan(seat, tileIndex) {
    const me = this.ctx.players[seat];
    // Adding a kan to an existing pon moves a tile out of the concealed hand and
    // into the meld, which can change the wait. Standard riichi forbids it
    // outright while in riichi — unlike ankan, which is legal if the waits are
    // unchanged. Both rule implementations used to allow it here.
    const kakanForbidden = me.riichi
      ? { error: true, reason: 'cannot add a kan to a pon while in riichi (chombo) - choose another tile' }
      : null;

    if (tileIndex !== undefined && tileIndex !== null && tileIndex >= 0) {
      const tileCode = P.tileToSaki({ index: tileIndex, red_dora: false });
      if (tileCode) {
        const k = norm(tileCode);
        const c = me.hand.filter((x) => norm(x) === k).length;
        if (c === 4) {
          if (me.riichi && !H.ankanKeepsWaits(me, k)) {
            return { error: true, reason: 'this ankan would change your riichi waits (chombo) - choose another tile' };
          }
          return { kind: 'ankan', tile: k };
        }
        const pon = me.melds.find((m) => m.type === 'pon' && norm(m.tiles[0]) === k);
        if (pon && c >= 1) return kakanForbidden || { kind: 'kakan', tile: k };
      }
    }

    // Auto-detect available ankan or kakan from hand and melds
    const cnt = {};
    for (const x of me.hand) { const k = norm(x); cnt[k] = (cnt[k] || 0) + 1; }
    const ankanTile = Object.keys(cnt).find((k) => cnt[k] === 4);
    if (ankanTile) {
      if (me.riichi && !H.ankanKeepsWaits(me, ankanTile)) {
        return { error: true, reason: 'this ankan would change your riichi waits (chombo) - choose another tile' };
      }
      return { kind: 'ankan', tile: ankanTile };
    }
    const ponUp = me.melds.find((m) => m.type === 'pon' && me.hand.some((h) => same(h, m.tiles[0])));
    if (ponUp) {
      return kakanForbidden || { kind: 'kakan', tile: norm(ponUp.tiles[0]) };
    }
    return null;
  }

  validateAct(seat, a, opts) {
    const me = this.ctx.players[seat];
    const { wantTsumo, firstDraw, isLastDraw } = opts;
    if (a.type === 'Tsumo') {
      if (!this.isAWin(this.scoreFor(seat, me.lastDrawn, { tsumo: true, kan: false, last: isLastDraw, tenhou: firstDraw }))) {
        return { ok: false, reason: 'tsumo not available' };
      }
      return { ok: true, action: a };
    }
    if (a.type === 'Kan') {
      const k = a.kan;
      if (!k) return { ok: false, reason: 'kan not possible' };
      if (k.error) return { ok: false, reason: k.reason || 'illegal kan (chombo) - choose another tile' };
      // Defence in depth: classifyHumanKan already refuses kakan while in riichi,
      // but the rule is cheap enough to assert again at the boundary.
      if (k.kind === 'kakan' && me.riichi) {
        return { ok: false, reason: 'cannot add a kan to a pon while in riichi (chombo)' };
      }
      if (this.ctx.kanCount >= 4 || this.ctx.rinshanIdx >= 4) return { ok: false, reason: 'no kan slots left' };
      return {
        ok: true,
        action: { type: 'Kan', kan: k, tile: k.tile },
      };
    }
    if (a.type === 'Riichi') {
      if (me.riichi) return { ok: false, reason: 'already riichi' };
      if (!me.melds.every((m) => !m.open)) return { ok: false, reason: 'open hand - riichi not allowed' };
      if (!H.canRiichi(this.scores[seat], this.ctx.poolTotal())) return { ok: false, reason: 'riichi needs 1000 pts and 4+ wall tiles' };
      const rest = this.handAfterDiscard(me, a.tile);
      if (rest === null) return { ok: false, reason: 'riichi discard tile not in hand' };
      if (H.shantenOf(rest) !== 0) return { ok: false, reason: 'riichi requires a tenpai discard' };
      return {
        ok: true,
        action: {
          type: 'Riichi',
          tile: a.tile,
          riichiFirst: this.isFirstDraw(me),
        },
      };
    }
    if (a.type === 'Discard') {
      if (me.riichi && a.tile !== null && me.lastDrawn !== null && norm(a.tile) !== norm(me.lastDrawn)) {
        return { ok: false, reason: 'riichi player may only tsumogiri' };
      }
      if (a.tile === null && me.lastDrawn === null) return { ok: false, reason: 'no drawn tile to discard' };
      if (a.tile !== null && !me.hand.some((x) => x === a.tile || norm(x) === norm(a.tile))) {
        return { ok: false, reason: 'tile not in hand' };
      }
      return { ok: true, action: a };
    }
    if (a.type === 'Pass') {
      if (me.riichi && me.lastDrawn) return { ok: true, action: { type: 'Discard', tile: null } };
      return { ok: false, reason: 'pass not valid on your turn' };
    }
    return { ok: false, reason: 'unexpected action' };
  }

  handAfterDiscard(me, tile) {
    if (tile === null) return me.lastDrawn ? [...me.hand].slice(0, me.hand.length - 1) : null;
    const idx = me.hand.findIndex((x) => same(x, tile));
    if (idx < 0) return null;
    return [...me.hand.slice(0, idx), ...me.hand.slice(idx + 1)];
  }

  botDecision(seat, me, opts = {}) {
    const rand = () => this.decide.next();
    if (opts.kanChoice) return { type: 'Kan', kan: opts.kanChoice, tile: opts.kanChoice.tile };
    if (opts.wantTsumo) return { type: 'Tsumo' };
    const di = H.botDiscard(me.hand, !!me.riichi, [], rand);
    const tile = me.hand[di];
    if (!me.riichi && me.melds.every((m) => !m.open)) {
      if (H.shantenOf(me.hand.filter((_, j) => j !== di)) === 0 && H.canRiichi(this.scores[seat], this.ctx.poolTotal())) {
        const p = process.env.SAKI_RIICHI_FORCE === '1' ? 1 : 0.45;
        if (rand() < p) return { type: 'Riichi', tile, riichiFirst: this.isFirstDraw(me) };
      }
    }
    return { type: 'Discard', tile };
  }

  // ============================================================== calling
  // Own-turn kan (human or bot). Returns an outcome {end,winner,winBy} or
  // {end:false,next}.
  async doOwnKan(seat, me, kan) {
    const ctx = this.ctx;
    const tile = kan.tile;

    // Choke point: every kan passes through here regardless of whether it came
    // from a human, a bot, or a future caller. Kakan while in riichi is never
    // legal (unlike ankan, which is conditional on leaving the waits unchanged),
    // so refuse it here rather than relying on each caller to check.
    if (kan.kind === 'kakan' && me.riichi) {
      console.log(`[bridge] P${seat} kakan refused: illegal while in riichi`);
      return { end: false, next: (seat + 1) % 4 };
    }

    if (kan.kind === 'kakan') {
      const hits = await this.collectRon(tile, seat, { chankan: true, label: 'CHANKAN' });
      if (hits.length) {
        return { end: true, winner: hits[0].seat, winBy: { type: 'ron', from: seat, hits, tile, flags: { chankan: true } } };
      }
      const pm = me.melds.find((m) => m.type === 'pon' && same(m.tiles[0], tile));
      const i = me.hand.findIndex((x) => same(x, tile));
      if (i < 0 || !pm) return { end: false, next: (seat + 1) % 4 };
      pm.tiles.push(me.hand.splice(i, 1)[0]);
      pm.type = 'kan';
      this.broadcast(P.evPlayerCalled({
        player: P.seatWind(seat, ctx.dealer),
        callType: 'Kakan',
        calledTile: P.sakiToTile(tile),
        tiles: P.tilesToProtocol(pm.tiles),
      }));
    } else {
      const tiles = [];
      for (let c = 0; c < 4; c++) {
        const i = me.hand.findIndex((x) => same(x, tile));
        if (i < 0) return { end: false, next: (seat + 1) % 4 };
        tiles.push(me.hand.splice(i, 1)[0]);
      }
      me.melds.push({ tiles, open: false, type: 'ankan' });
      this.broadcast(P.evPlayerCalled({
        player: P.seatWind(seat, ctx.dealer),
        callType: 'Ankan',
        calledTile: P.sakiToTile(tile),
        tiles: P.tilesToProtocol(tiles),
      }));
    }
    ctx.revealKanDora();
    ctx.callsMade++;
    H.clearAllIppatsu(ctx.players);
    ctx.kansBy[seat]++;

    if (ctx.state.powers && typeof ctx.state.powers.broadcastPlayerKan === 'function') {
      ctx.state.powers.broadcastPlayerKan(seat, ctx.state);
    }
    if (this.powerOf(seat) !== 'none') {
      this.maybeActivateTier(seat, ctx.kansBy[seat]);
    }

    const rt = ctx.dead[ctx.rinshanIdx++];
    if (rt === undefined) return { end: true, winner: -1, winBy: null };
    me.hand.push(rt);
    me.lastDrawn = rt;

    const trs = this.scoreFor(seat, rt, { tsumo: true, kan: true, last: false, tenhou: false });
    const wantTsumo = this.isAWin(trs);

    // Emit Rinshan draw events
    this.room.sendTo(seat, P.event(P.evTileDrawn({
      tile: P.sakiToTile(rt),
      remaining: ctx.poolTotal(),
      canTsumo: wantTsumo,
      canRiichi: false,
      isFuriten: this.furitenNow(me),
    })));
    for (let s = 0; s < 4; s++) {
      if (s !== seat) {
        this.room.sendTo(s, P.event(P.evOtherPlayerDrew({
          player: P.seatWind(seat, ctx.dealer),
          remaining: ctx.poolTotal(),
        })));
      }
    }

    if (wantTsumo && me.isCpu) {
      const result = { type: 'tsumo', winner: seat, tag: 'RINSHAN' };
      this.settlePowerHook(result);
      return { end: true, winner: seat, winBy: { type: 'tsumo', seat, winTile: rt, rinshan: true, haitei: false, first: false } };
    }

    const disc = await this.discardAfterCall(seat, me, []);
    this.broadcastPowerStatus();
    if (!disc) return { end: false, next: (seat + 1) % 4 };
    if (disc.end) return disc;
    const houtei = ctx.poolTotal() === 0;
    const nextCall = await this.resolveCallWindow(seat, disc.tile, { houtei });
    if (nextCall) return nextCall;
    return { end: false, next: (seat + 1) % 4 };
  }

  maybeActivateTurnPower(seat) {
    const power = this.powerOf(seat);
    if (power === 'none') return;
    const hooks = this.ctx.state.powers ? this.ctx.state.powers.hooksFor(seat) : null;
    if (!hooks) return;
    const ctx = this.ctx;
    const state = ctx.state;
    const type = state.powers ? state.powers.powerTypeOf(seat) : 'flow';

    // Normal-type powers are fully automatic: no armed tier, no cost, always
    // at full strength. Fire the onTurnStart condition if it exists.
    if (type === 'normal') {
      let activation = null;
      if (typeof hooks.onTurnStart === 'function') {
        activation = hooks.onTurnStart(state, { type: 'normal', armedTier: 0 });
      }
      if (activation && activation.activated) {
        const eventType = (activation.event && activation.event.type)
          || (activation.result && activation.result.event && activation.result.event.type)
          || 'NORMAL_TRIGGER';
        console.log(`[bridge] normal power ${power} triggered ${eventType} for seat ${seat}`);
        this.broadcast(P.evPowerActivated({
          player: P.seatWind(seat, ctx.dealer),
          power,
          tier: 0,
          eventType,
        }));
        this.broadcastPowerStatus();
      }
      return;
    }

    if (power === 'saki') return; // flow Saki is kan-only

    // Human player uses explicitly armed tier (0 = conserve/off); CPU defaults to 'auto'
    const armedTier = this.isCpuSeat(seat) ? 'auto' : (this.armedTiers[seat] || 0);
    if (armedTier === 0) return;

    let activation = null;
    if (typeof hooks.onTurnStart === 'function') {
      activation = hooks.onTurnStart(state, { armedTier });
    } else {
      const order = armedTier === 'auto' ? [4, 3, 2, 1] : [armedTier];
      for (const t of order) {
        const fnName = `tryActivateTier${t}`;
        if (typeof hooks[fnName] === 'function') {
          try {
            const r = hooks[fnName].call(hooks, state);
            if (r && r.ok) { activation = { activated: true, tier: t, result: r }; break; }
          } catch (e) { warnOnce(`tryActivateTier${t}`, e); }
        }
      }
    }

    if (activation && activation.activated) {
      const tier = activation.tier;
      const eventType = (activation.result && activation.result.event && activation.result.event.type) || `TIER_${tier}`;
      console.log(`[bridge] ${power} activated ${eventType} (Tier ${tier}) for seat ${seat}`);
      this.broadcast(P.evPowerActivated({
        player: P.seatWind(seat, ctx.dealer),
        power,
        tier,
        eventType,
      }));
      if (!this.isCpuSeat(seat)) {
        this.armedTiers[seat] = 0; // Reset after one-shot activation
      }
      this.broadcastPowerStatus();
    }
  }

  maybeActivateTier(seat, kanCount) {
    const power = this.powerOf(seat);
    const hooks = this.ctx.state.powers ? this.ctx.state.powers.hooksFor(seat) : null;
    if (!hooks) return;
    const ctx = this.ctx;
    const state = ctx.state;
    const type = state.powers ? state.powers.powerTypeOf(seat) : 'flow';

    // Normal-type powers need no arming and spend nothing: the hook evaluates
    // its own condition and pins the on-deck replacement slot when it fires.
    if (type === 'normal') {
      let activation = null;
      if (typeof hooks.onKanDeclared === 'function') {
        activation = hooks.onKanDeclared(state, { kanCount, rinshanIdx: ctx.rinshanIdx, armedTier: 0 });
      }
      if (activation && activation.activated) {
        const eventType = (activation.event && activation.event.type)
          || (activation.result && activation.result.event && activation.result.event.type)
          || 'NORMAL_KAN';
        console.log(`[bridge] normal power ${power} triggered ${eventType} (kan ${kanCount})`);
        this.broadcast(P.evPowerActivated({
          player: P.seatWind(seat, ctx.dealer),
          power,
          tier: 0,
          eventType,
        }));
        this.broadcastPowerStatus();
      }
      return;
    }

    // Human player uses explicitly armed tier (or 'auto' if CPU)
    const armedTier = this.isCpuSeat(seat) ? 'auto' : (this.armedTiers[seat] || 0);
    if (armedTier === 0) return; // Conserve meter on Kan!

    let activation = null;
    if (typeof hooks.onKanDeclared === 'function') {
      activation = hooks.onKanDeclared(this.ctx.state, { armedTier, kanCount, rinshanIdx: this.ctx.rinshanIdx });
    } else {
      const order = armedTier === 'auto' ? [4, 3, 2, 1] : [armedTier];
      for (const t of order) {
        const name = `tryActivateTier${t}`;
        if (typeof hooks[name] === 'function') {
          try {
            const r = hooks[name].call(hooks, this.ctx.state, kanCount, this.ctx.rinshanIdx);
            if (r && r.ok) {
              activation = { activated: true, tier: t, result: r };
              break;
            }
          } catch (e) { warnOnce(`${power}:onKanDeclared`, e); }
        }
      }
    }

    if (activation && activation.activated) {
      const r = activation.result;
      const tier = activation.tier;
      // Saki tiers now deterministically pin the on-deck slot (win if live,
      // else best ukeire). Only fall back to weighted sampling when the hook
      // did NOT pin — never overwrite a guaranteed slot.
      if (r && !r.pinned && r.weightOf && typeof core.sampleRinshan === 'function' && this.ctx.rinshanIdx < 4) {
        core.sampleRinshan(this.ctx.state, this.ctx.rinshanIdx, r.weightOf);
      }
      console.log(`[bridge] ${power} tier ${tier} activated (kan ${kanCount})`);
      const eventType = (r && r.event && r.event.type) || `TIER_${tier}`;
      this.broadcast(P.evPowerActivated({
        player: P.seatWind(seat, this.ctx.dealer),
        power,
        tier,
        eventType,
      }));
      if (!this.isCpuSeat(seat)) {
        this.armedTiers[seat] = 0;
      }
      this.broadcastPowerStatus();
    }
  }

  // Repeats the placement step that a real engine loops for the Saki
  // settlement hook. Called for wins so powers can react (flow burn etc.).
  settlePowerHook(result) {
    try {
      if (typeof this.ctx.state.powers.onSettlement === 'function') {
        this.ctx.state.powers.onSettlement(result, this.ctx.state);
      }
    } catch (e) { warnOnce('onSettlement', e); }
  }

  // Discard right after a call/kan. Returns {tile,...} or null.
  async discardAfterCall(seat, me, banned) {
    this.phase = PHASE.CALL_DISCARD;
    this.activeSeat = seat;
    let action;
    if (!me.isCpu) {
      for (;;) {
        const a = await this.request(seat, new Set(['Discard', 'Riichi', 'Tsumo', 'Pass']));
        if (a.type === 'Tsumo') {
          const r = this.scoreFor(seat, me.lastDrawn, { tsumo: true, kan: true, last: false, tenhou: false });
          if (!this.isAWin(r)) { this.sendError(seat, 'InvalidAction', 'tsumo not available'); continue; }
          const result = { type: 'tsumo', winner: seat, tag: 'RINSHAN' };
          this.settlePowerHook(result);
          return { end: true, winner: seat, winBy: { type: 'tsumo', seat, winTile: me.lastDrawn, rinshan: true, haitei: false, first: false } };
        }
        if (a.type !== 'Discard') { this.sendError(seat, 'InvalidAction', 'must discard after a call'); continue; }
        if (banned.some((b1) => a.tile && norm(b1) === norm(a.tile))) {
          this.sendError(seat, 'InvalidAction', `kuikae: ${a.tile} is illegal after this call`);
          continue;
        }
        if (a.tile === null) { this.sendError(seat, 'InvalidAction', 'no drawn tile to discard'); continue; }
        if (!me.hand.some((x) => x === a.tile || norm(x) === norm(a.tile))) {
          this.sendError(seat, 'InvalidAction', 'tile not in hand');
          continue;
        }
        action = a;
        break;
      }
    } else {
      const callStartTime = Date.now();
      const di = H.botDiscard(me.hand, false, banned, () => this.decide.next());
      action = { type: 'Discard', tile: me.hand[di] };
      await botWait(callStartTime);
    }
    return this.executeDiscard(seat, action.tile, { banned });
  }

  // Backward-compatible collectRon helper (delegates to resolveCallWindow).
  async collectRon(tile, from, flags = {}) {
    const res = await this.resolveCallWindow(from, tile, { ...flags, chankan: true });
    if (res && res.end && res.winBy && res.winBy.type === 'ron') {
      return res.winBy.hits;
    }
    return [];
  }

  // Unified, simultaneous call window for Ron, Pon/Kan, and Chi with priority arbitration.
  async resolveCallWindow(from, tile, flags = {}) {
    const ctx = this.ctx;
    const { players } = ctx;
    this.phase = PHASE.CALL_WINDOW;
    this.activeSeat = -1;

    // 1. Collect all valid call options for the other 3 seats
    const candidateMap = new Map();
    for (let k = 1; k <= 3; k++) {
      const q = (from + k) % 4;
      const qp = players[q];

      let ronAtt = null;
      const att = H.tryRon(qp, tile, this.shootCtx(q, flags.chankan, flags.houtei), players, ctx.dead, {
        chankan: !!flags.chankan,
        minHan: 1,
      });
      if (att.win) ronAtt = att;

      let ponOpts = null;
      let canDaimin = false;
      if (!flags.chankan && !qp.riichi) {
        const nSame = qp.hand.filter((x) => same(x, tile)).length;
        if (nSame >= 2) {
          ponOpts = this.ponOptions(qp, tile);
          if (nSame >= 3 && ctx.kanCount < 4 && ctx.rinshanIdx < 4) {
            canDaimin = true;
          }
        }
      }

      let chiOpts = null;
      if (!flags.chankan && q === (from + 1) % 4 && !qp.riichi && qp.hand.length > 0) {
        const rawOpts = H.chiOptions(qp.hand, tile);
        if (rawOpts.length) chiOpts = rawOpts;
      }

      if (ronAtt || ponOpts || chiOpts) {
        const calls = [];
        if (ronAtt) calls.push('Ron');
        if (canDaimin) calls.push('Daiminkan');
        if (ponOpts) calls.push({ Pon: { options: ponOpts } });
        if (chiOpts) {
          const suit = norm(tile)[1];
          calls.push({ Chi: { options: chiOpts.map((o) => o.map((n) => P.sakiToTile(n + suit))) } });
        }
        candidateMap.set(q, { qp, ronAtt, ponOpts, canDaimin, chiOpts, calls });
      }
    }

    if (candidateMap.size === 0) {
      this.phase = PHASE.TURN_ACT;
      return null;
    }

    // 2. Concurrently poll candidates
    const candidateSeats = Array.from(candidateMap.keys());
    const responses = await new Promise((resolveAll) => {
      let resolved = false;
      const results = [];
      let pendingCount = candidateSeats.length;

      for (const q of candidateSeats) {
        (async () => {
          const c = candidateMap.get(q);
          const qp = c.qp;
          let res;
          if (qp.isCpu) {
            if (c.ronAtt) res = { seat: q, type: 'Ron' };
            else if (c.canDaimin && this.decide.next() < 0.25) res = { seat: q, type: 'Kan' };
            else if (c.ponOpts && H.botWantsCall(H.shantenOf(qp.hand) - H.shantenOf(this.removeCopies(qp.hand, tile, 2)), false, () => this.decide.next())) {
              res = { seat: q, type: 'Pon' };
            } else if (c.chiOpts && this.decide.next() < 0.35) {
              const chosen = c.chiOpts[Math.floor(this.decide.next() * c.chiOpts.length)];
              res = { seat: q, type: 'Chi', tiles: chosen };
            } else {
              res = { seat: q, type: 'Pass' };
            }
          } else {
            this.room.sendTo(q, P.event(P.evCallAvailable({
              tile: P.sakiToTile(tile),
              discarder: P.seatWind(from, ctx.dealer),
              calls: c.calls,
            })));
            const allowed = new Set(['Pass']);
            if (c.ronAtt) allowed.add('Ron');
            if (c.ponOpts) allowed.add('Pon');
            if (c.canDaimin) allowed.add('Kan');
            if (c.chiOpts) allowed.add('Chi');
            const action = await this.request(q, allowed);
            res = { seat: q, ...action };
          }

          if (resolved) return;
          results.push(res);
          pendingCount--;

          // If Ron was claimed and no other candidate can also Ron:
          const remainingCouldRon = candidateSeats.some(
            (s) => !results.some((r) => r.seat === s) && candidateMap.get(s)?.ronAtt
          );
          if (res.type === 'Ron' && !remainingCouldRon) {
            resolved = true;
            for (const s of candidateSeats) {
              if (!results.some((r) => r.seat === s)) this.cancelRequest(s);
            }
            resolveAll(results);
            return;
          }

          if (pendingCount === 0) {
            resolved = true;
            resolveAll(results);
          }
        })().catch((err) => {
          console.error('[bridge] resolveCallWindow candidate error:', err);
          if (!resolved) {
            pendingCount--;
            if (pendingCount === 0) { resolved = true; resolveAll(results); }
          }
        });
      }
    });

    // 3. Priority Arbitration:
    //
    // IMPORTANT: `responses` arrives in *response* order, not turn order. CPU
    // candidates resolve synchronously so they happen to land in turn order, but
    // human candidates are awaited over the wire and can land in any order.
    // Standard riichi gives pon/daiminkan to the claimant nearest the discarder
    // in turn order, so every arbitration below ranks explicitly rather than
    // relying on arrival order.
    const turnRank = (seat) => (seat - from + 4) % 4;
    const byTurnOrder = (a, b) => turnRank(a.seat) - turnRank(b.seat);
    const ordered = [...responses].sort(byTurnOrder);

    // Priority 1: Ron claims
    const ronClaims = ordered.filter((r) => r.type === 'Ron');
    if (ronClaims.length > 0) {
      for (const r of ordered) {
        if (candidateMap.get(r.seat)?.ronAtt && r.type !== 'Ron') {
          players[r.seat].tempFuriten = true;
        }
      }
      this.phase = PHASE.TURN_ACT;
      // Turn order also decides who collects the riichi sticks below, so hits
      // must be ordered rather than in response order.
      const hits = ronClaims.map((r) => ({ seat: r.seat }));
      return {
        end: true,
        winner: hits[0].seat,
        winBy: {
          type: 'ron',
          from,
          hits,
          tile,
          flags,
        },
      };
    }

    // Mark temporary furiten for players who passed Ron
    for (const r of ordered) {
      if (candidateMap.get(r.seat)?.ronAtt && r.type !== 'Ron') {
        players[r.seat].tempFuriten = true;
      }
    }

    // Priority 2: Pon / Daiminkan claims — nearest claimant in turn order wins.
    const ponClaim = ordered.find(
      (r) => r.type === 'Pon' || (r.type === 'Kan' && candidateMap.get(r.seat)?.canDaimin)
    );
    if (ponClaim) {
      const callKind = ponClaim.type === 'Kan' ? 'daiminkan' : 'pon';
      return await this.doOpenCall(ponClaim.seat, from, tile, callKind);
    }

    // Priority 3: Chi claims (shimocha only, so at most one seat can claim)
    const chiClaim = ordered.find((r) => r.type === 'Chi');
    if (chiClaim && candidateMap.get(chiClaim.seat)?.chiOpts) {
      let chosen = chiClaim.tiles;
      if (!chosen || !Array.isArray(chosen) || chosen.length !== 2) {
        chosen = candidateMap.get(chiClaim.seat).chiOpts[0];
      }
      return await this.doOpenChi(chiClaim.seat, from, tile, chosen);
    }

    this.phase = PHASE.TURN_ACT;
    return null;
  }

  ponOptions(qp, tile) {
    const held = qp.hand.filter((x) => same(x, tile));
    const opts = [];
    for (let i = 0; i < held.length; i++) {
      for (let j = i + 1; j < held.length; j++) opts.push([held[i], held[j]]);
    }
    return opts.map((pair) => pair.map(P.sakiToTile));
  }

  removeCopies(hand, tile, n) {
    const out = [...hand];
    for (let c = 0; c < n; c++) {
      const i = out.findIndex((x) => same(x, tile));
      if (i < 0) break;
      out.splice(i, 1);
    }
    return out;
  }

  async doOpenCall(q, from, tile, kind) {
    const ctx = this.ctx;
    const qp = ctx.players[q];
    const tiles = [];
    const n = kind === 'daiminkan' ? 3 : 2;
    for (let c = 0; c < n; c++) {
      const i = qp.hand.findIndex((x) => same(x, tile));
      if (i < 0) break;
      tiles.push(qp.hand.splice(i, 1)[0]);
    }
    ctx.players[from].discards.pop();
    tiles.push(tile);
    qp.melds.push({ tiles, open: true, type: kind === 'daiminkan' ? 'kan' : 'pon' });
    this.broadcast(P.evPlayerCalled({
      player: P.seatWind(q, ctx.dealer),
      fromPlayer: P.seatWind(from, ctx.dealer),
      callType: kind === 'daiminkan' ? 'Daiminkan' : 'Pon',
      calledTile: P.sakiToTile(tile),
      tiles: P.tilesToProtocol(tiles),
    }));
    console.log(`[bridge] P${q} ${kind.toUpperCase()} ${tile}`);
    ctx.callsMade++;
    H.clearAllIppatsu(ctx.players);

    if (!qp.isCpu) {
      this.room.sendTo(q, P.event(P.evHandUpdated({ hand: P.tilesToProtocol([...qp.hand]) })));
    }

    if (kind === 'daiminkan') {
      ctx.kansBy[q]++;
      ctx.revealKanDora();
      if (ctx.state.powers && typeof ctx.state.powers.broadcastPlayerKan === 'function') {
        ctx.state.powers.broadcastPlayerKan(q, ctx.state);
      }
      if (this.powerOf(q) !== 'none') {
        this.maybeActivateTier(q, ctx.kansBy[q]);
      }
      const rt = ctx.dead[ctx.rinshanIdx++];
      if (rt !== undefined) {
        qp.hand.push(rt);
        qp.lastDrawn = rt;
        const trs = this.scoreFor(q, rt, { tsumo: true, kan: true, last: false, tenhou: false });
        const wantTsumo = this.isAWin(trs);

        this.room.sendTo(q, P.event(P.evTileDrawn({
          tile: P.sakiToTile(rt),
          remaining: ctx.poolTotal(),
          canTsumo: wantTsumo,
          canRiichi: false,
          isFuriten: this.furitenNow(qp),
        })));
        for (let s = 0; s < 4; s++) {
          if (s !== q) {
            this.room.sendTo(s, P.event(P.evOtherPlayerDrew({
              player: P.seatWind(q, ctx.dealer),
              remaining: ctx.poolTotal(),
            })));
          }
        }

        if (wantTsumo && qp.isCpu) {
          this.settlePowerHook({ type: 'tsumo', winner: q, tag: 'RINSHAN' });
          return { end: true, winner: q, winBy: { type: 'tsumo', seat: q, winTile: rt, rinshan: true, haitei: false, first: false } };
        }
      }
    }

    const banned = kind === 'daiminkan' ? [] : [norm(tiles[0])];
    const disc = await this.discardAfterCall(q, qp, banned);
    this.broadcastPowerStatus();
    if (!disc) return { end: false, next: (q + 1) % 4 };
    if (disc.end) return disc;
    const houtei = ctx.poolTotal() === 0;
    const nextCall = await this.resolveCallWindow(q, disc.tile, { houtei });
    if (nextCall) return nextCall;
    return { end: false, next: (q + 1) % 4 };
  }

  async doOpenChi(q, from, tile, chosen) {
    const ctx = this.ctx;
    const qp = ctx.players[q];
    const tiles = [tile];
    const suit = norm(tile)[1];
    for (const n of chosen) {
      const target = typeof n === 'string' && (n.endsWith('m') || n.endsWith('p') || n.endsWith('s') || n.endsWith('z'))
        ? norm(n)
        : n + suit;
      const i = qp.hand.findIndex((x) => norm(x) === target);
      if (i < 0) break;
      tiles.push(qp.hand.splice(i, 1)[0]);
    }
    if (tiles.length !== 3) return null; // shouldn't happen (validated)
    ctx.players[from].discards.pop();
    qp.melds.push({ tiles, open: true, type: 'chi' });
    this.broadcast(P.evPlayerCalled({
      player: P.seatWind(q, ctx.dealer),
      fromPlayer: P.seatWind(from, ctx.dealer),
      callType: 'Chi',
      calledTile: P.sakiToTile(tile),
      tiles: P.tilesToProtocol(tiles),
    }));
    console.log(`[bridge] P${q} CHI ${tile} [${chosen.join('+')}]`);
    ctx.callsMade++;
    H.clearAllIppatsu(ctx.players);

    if (!qp.isCpu) {
      this.room.sendTo(q, P.event(P.evHandUpdated({ hand: P.tilesToProtocol([...qp.hand]) })));
    }

    const banned = H.kuikaeBannedChi(tiles[1], tiles[2]);
    const disc = await this.discardAfterCall(q, qp, banned);
    this.broadcastPowerStatus();
    if (!disc) return { end: false, next: (q + 1) % 4 };
    const houtei = ctx.poolTotal() === 0;
    const nextCall = await this.resolveCallWindow(q, disc.tile, { houtei });
    if (nextCall) return nextCall;
    return { end: false, next: (q + 1) % 4 };
  }

  // ====================================================== hand resolution
  playerHandInfo(seat) {
    const c = this.ctx;
    const p = c.players[seat];
    const sorter = (a, b) => a.tiles.length - b.tiles.length;
    return {
      wind: P.seatWind(seat, c.dealer),
      hand: P.tilesToProtocol(sortHand([...p.hand])),
      melds: p.melds.slice().sort(sorter).map((m) => ({
        call_type: { pon: 'Pon', chi: 'Chi', kan: 'Daiminkan', ankan: 'Ankan', kakan: 'Kakan' }[m.type] || 'Pon',
        tiles: P.tilesToProtocol(m.tiles),
      })),
      pei: [],
    };
  }

  playerHandsInfo() {
    return [0, 1, 2, 3].map((s) => this.playerHandInfo(s));
  }

  async finishHand(winner, winBy) {
    this.phase = PHASE.ROUND_END;
    this.activeSeat = -1;
    const ctx = this.ctx;
    const { players } = ctx;
    const dealer = ctx.dealer;

    if (winBy !== null) {
      const isTsumo = winBy.type === 'tsumo';
      const wins = isTsumo
        ? [{ seat: winner, flags: { tsumo: true, winTile: winBy.winTile, kan: winBy.rinshan, last: winBy.haitei, tenhou: winBy.first } }]
        : winBy.hits.map((h) => ({
          seat: h.seat,
          flags: { tsumo: false, winTile: winBy.tile, kan: !!winBy.flags.chankan, last: !!winBy.flags.houtei, tenhou: false },
        }));

      // Apply all payments first so every RoundWon shares the same final scores.
      const awards = [];
      for (const w of wins) {
        const r = this.rescore(w.seat, w.flags);
        w.r = r;
        let pay = 0;
        if (isTsumo) {
          if (w.seat === dealer) {
            for (let i = 0; i < 4; i++) {
              if (i === w.seat) continue;
              const p0 = r.oya[0] + 100 * this.honba;
              this.scores[i] -= p0;
              pay += p0;
            }
          } else {
            for (let i = 0; i < 4; i++) {
              if (i === w.seat) continue;
              const base = i === dealer ? r.ko[0] : r.ko[1];
              const p0 = base + 100 * this.honba;
              this.scores[i] -= p0;
              pay += p0;
            }
          }
          this.scores[w.seat] += pay;
        } else {
          pay = r.ten + 300 * this.honba;
          this.scores[winBy.from] -= pay;
          this.scores[w.seat] += pay;
        }
        w.pay = pay;
      }
      // Riichi sticks to the nearest winner in turn order (wins[0]).
      const sticksGain = ctx.riichiPool;
      this.scores[wins[0].seat] += sticksGain;
      ctx.riichiPool = 0;

      // Emit one RoundWon per winner.
      for (const w of wins) {
        const scorePoints = w.pay + (w === wins[0] ? sticksGain : 0);
        this.broadcast(P.evRoundWon({
          winner: P.seatWind(w.seat, dealer),
          loser: isTsumo ? null : P.seatWind(winBy.from, dealer),
          winning_tile: P.sakiToTile(w.flags.winTile),
          scores: [...this.scores],
          yakuList: Y.buildYakuList(w.r),
          han: w.r.han,
          fu: w.r.fu,
          scorePoints,
          rank: Y.rankFromResult(w.r),
          hasOpened: players[w.seat].melds.some((m) => m.open),
          uradoraIndicators: players[w.seat].riichi || players[w.seat].doubleRiichi
            ? P.tilesToProtocol(ctx.uraInd)
            : [],
          riichiSticks: sticksGain / 1000,
          honba: this.honba,
          honbaPoints: isTsumo ? 100 * this.honba : 300 * this.honba,
          playerHands: this.playerHandsInfo(),
        }));
        console.log(`[bridge] WIN P${w.seat} ${isTsumo ? 'tsumo' : 'ron'} ${w.r.text || ''} han=${w.r.han} fu=${w.r.fu} +${scorePoints}`);
        this.settlePowerHook({ type: isTsumo ? 'tsumo' : 'ron', winner: w.seat, tag: winBy.rinshan ? 'RINSHAN' : '' });
      }
    } else {
      // Exhaustive draw.
      const tenpai = this.tenpaiSeats();
      const nTen = tenpai.length;
      if (nTen > 0 && nTen < 4) {
        const give = [0, 3000, 1500, 1000][nTen];
        const take = [0, 1000, 1500, 3000][nTen];
        for (let i = 0; i < 4; i++) this.scores[i] += tenpai.includes(i) ? give : -take;
      }
      // Riichi sticks must not vanish when a hand is drawn. The win path awards
      // ctx.riichiPool to the nearest winner; here the standard rule applies —
      // the sticks go to the tenpai players, split evenly. If nobody is tenpai
      // they carry to the next hand, and run() settles anything still carried
      // when the match ends. Without this a riichi declared in a drawn hand
      // silently destroys 1000 points.
      const sticks = ctx.riichiPool;
      ctx.riichiPool = 0;
      let awarded = 0;
      if (sticks > 0 && tenpai.length > 0) {
        // Split as evenly as a whole number of points allows: 1000 across 3
        // tenpai players is 334/333/333, not 1000/0/0.
        const n = tenpai.length;
        const each = Math.floor(sticks / n);
        let remainder = sticks - each * n;
        for (const s of tenpai) {
          const amt = each + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;
          this.scores[s] += amt;
          awarded += amt;
        }
      } else {
        this.riichiCarry = sticks;
      }

      this.broadcast(P.evRoundDraw({
        scores: [...this.scores],
        reason: 'Exhaustive',
        tenpai: tenpai.map((s) => P.seatWind(s, dealer)),
        riichiSticks: sticks / 1000,
        playerHands: this.playerHandsInfo(),
        declarer: null,
      }));
      console.log(`[bridge] EXHAUSTIVE tenpai=${tenpai.map((s) => 'P' + s).join(',')} sticks=${sticks / 1000} awarded=${awarded / 1000} carried=${this.riichiCarry / 1000}`);
    }
  }
}

module.exports = { Room, Table, START_SCORE, TOTAL_ROUNDS, defaultPowerSeats };
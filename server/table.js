'use strict';
// table.js — Table: one match of the saki engine, driven over protocol v6.
//
// Split out of room.js (which owns the lobby and seats) to keep each file a
// readable size. The rules flow mirrors engine/game.js: kan/riichi/tsumo/ron/
// calls, ippatsu, furiten, exhaustive-draw tenpai payments, renchan, honba and
// riichi sticks.
//
// Chombo is a penalty, not a refusal: an illegal ankan after riichi (the kan
// would change the waits) is allowed, warned about, charged a mangan penalty,
// and the hand replays (see chomboHand). Kakan while in riichi stays refused:
// a riichi hand has no open pon, and game.js refuses it too. Still not
// implemented: disconnection resync (disconnect = CPU substitution) and the
// human kyuushu prompt (human 9-kind hands auto play on; CPU seats declare at
// the standard rate). Everything else in the offline game.js loop — all five
// abortive draws, nagashi mangan, agari-yame and enchousen — is implemented here.

const core = require('../engine/core');
const { PowerDispatcher } = require('../engine/powers');
const { createRNG } = require('../engine/rng');
const { KINDS, norm, same, DORA_NEXT } = require('../engine/tiles');
const { wanpaiPartition } = require('../engine/invariants');
const { scoreHand } = require('../engine/scoring');
const P = require('./protocol');
const H = require('../engine/helpers');
const Y = require('./yaku-map');
const { ROSTERS } = require('./rosters');
const { RULES } = require('../engine/rules-config');
const MF = require('../engine/match-flow');
const TC = require('../engine/turn-core');

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

// Invoke a character hook defensively. A bug in a power must not break the
// match — but it must not be silent, and (because the hand driver is one big
// async chain) an unguarded throw also rejected run() and bricked the room.
// Every hook call goes through here so there is exactly one policy.
function callHook(hooks, name, ...args) {
  if (!hooks || typeof hooks[name] !== 'function') return null;
  try {
    return hooks[name].call(hooks, ...args);
  } catch (e) {
    warnOnce(name, e);
    return null;
  }
}

const KIND_ORDER = {};
KINDS.forEach((k, i) => {
  KIND_ORDER[k] = i;
});

// These used to be bare literals here and in engine/game.js, so the two rule
// front-ends could drift apart silently. They come from RULES now, and
// engine/tests/rules-config-parity.test.js fails if either file reintroduces a
// hardcoded copy.
const START_SCORE = RULES.startScore;
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
    const ka = KIND_ORDER[norm(a)],
      kb = KIND_ORDER[norm(b)];
    if (ka !== kb) return ka - kb;
    return (a[0] === '0' ? 1 : 0) - (b[0] === '0' ? 1 : 0); // plain 5 before red 0
  });
  return hand;
}

const BOT_MIN_DELAY_MS =
  process.env.BOT_DELAY_MS !== undefined
    ? parseInt(process.env.BOT_DELAY_MS, 10)
    : process.env.NODE_ENV === 'test'
      ? 0
      : 1000;

function botWait(startTime, minMs = BOT_MIN_DELAY_MS) {
  if (minMs <= 0) return Promise.resolve();
  const elapsed = Date.now() - startTime;
  if (elapsed < minMs) {
    return new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  }
  return Promise.resolve();
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
    this.overtime = false; // enchousen: extra hands past all-last while the dealer repeats
    this.substituted = [false, false, false, false];
    this.decide = createRNG(this.seed ^ 0x6d2b79f5);
    this.requests = new Map(); // seat -> {kinds:Set, resolve}
    this.mailbox = new Map(); // seat -> [{action, kinds}]
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

  powerOf(seat) {
    return this.powerSeats[seat] || 'none';
  }

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
          try {
            isActive = !!hooks.isPowerActive(state);
          } catch (e) {
            warnOnce('isPowerActive', e);
          }
        }
        let desc = '';
        if (hooks && hooks.meta && hooks.meta.passiveName) desc = hooks.meta.passiveName;
        if (hooks && typeof hooks.getHudAdvice === 'function') {
          try {
            desc = hooks.getHudAdvice(state) || desc;
          } catch (e) {
            warnOnce('getHudAdvice', e);
          }
        }
        this.broadcast(
          P.evSuperpowerIndicator({
            seat: s,
            active: isActive,
            type: 'normal',
            gauge: null,
            power,
            description: desc,
            armedTier: 0,
            availableTiers: [],
          })
        );
        continue;
      }

      const flowVal = state.flow ? Math.round(state.flow.get(s)) : 50;
      const gauge = Math.min(100, Math.max(0, Math.round((flowVal / 150) * 100)));
      let isActive = false;
      let desc = `Flow: ${flowVal} / 150`;
      const hs = callHook(hooks, '_state');
      if (hs && typeof hs === 'object') {
        for (const val of Object.values(hs)) {
          if (typeof val === 'number' && val > 0) isActive = true;
          if (typeof val === 'boolean' && val) isActive = true;
        }
      }
      if (power === 'nodoka') {
        if (hooks && typeof hooks.getHudAdvice === 'function') {
          desc = callHook(hooks, 'getHudAdvice', state) || desc;
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
      const armedTier = this.armedTiers ? this.armedTiers[s] || 0 : 0;
      let availableTiers = [];
      if (hooks && typeof hooks.getTierInfo === 'function') {
        const tiers = callHook(hooks, 'getTierInfo', state);
        availableTiers = Array.isArray(tiers) ? tiers : [];
      }
      this.broadcast(
        P.evSuperpowerIndicator({
          seat: s,
          active: isActive,
          gauge,
          power,
          description: desc,
          armedTier,
          availableTiers,
        })
      );
    }
  }

  broadcastRoomState() {
    this.room.broadcastRoomState();
  }
  sendError(seat, code, message) {
    this.room.sendError(seat, code, message);
    if (this.ctx && this.ctx.players && this.ctx.players[seat] && !this.isCpuSeat(seat)) {
      const me = this.ctx.players[seat];
      this.room.sendTo(seat, P.event(P.evHandUpdated({ hand: P.tilesToProtocol(sortHand([...me.hand])) })));
    }
  }

  // Mailbox + request: client actions may arrive before we register the
  // wait (async socket), so queue them; `request` drains the queue first.
  clearMailbox() {
    for (const s of this.mailbox.keys()) this.mailbox.set(s, []);
  }

  propose(seat, action) {
    const req = this.requests.get(seat);
    if (req && req.kinds.has(action.type)) {
      this.requests.delete(seat);
      req.resolve(action);
      return true;
    }
    const box = this.mailbox.get(seat);
    // Bound the queue: a client spamming invalid actions must not grow memory
    // without limit, and stale Ron/Chi/Pon intents must not linger to be
    // auto-consumed by a later call window without fresh user intent.
    if (box.length >= 10) box.shift();
    box.push({ action, kinds: new Set([action.type]) });
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
      // Ron/Chi/Pon are only meaningful inside resolveCallWindow, which pulls
      // from its own request set. Queuing them here lets a stale intent sit in
      // the mailbox and be auto-consumed by a later call window.
      if (action.type === 'Ron' || action.type === 'Chi' || action.type === 'Pon') {
        this.sendError(seat, 'InvalidAction', `${action.type} is only valid in a call window`);
        return;
      }
    }
    this.propose(seat, action);
  }

  markReady(seat) {
    this.readyReceived[seat] = true;
    const r = this.readyRequests.get(seat);
    if (r) {
      this.readyRequests.delete(seat);
      r.resolve();
    }
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
    if (ready) {
      this.readyRequests.delete(seat);
      ready.resolve();
    }
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

  // Enchousen han floor (ryanhan-shibari): during overtime a win needs 2+ han.
  // Identical to isAWin when not in overtime, so wiring it everywhere is safe.
  winMeetsFloor(r) {
    return !!(r && (r.yakuman > 0 || r.han >= MF.minHan(this.overtime)));
  }

  // Why a tsumo is NOT available, for logs and client hints. Does not change
  // legality: wantTsumo stays isAWin && winMeetsFloor. Separates the two
  // things players conflate as "yaku/noten": shape-incomplete (noten) vs
  // complete-but-yakuless (no-yaku) vs overtime floor (shibari).
  // Returns 'noten' | 'no-yaku' | 'shibari' | null (null = winnable).
  tsumoBlockReason(seat, r) {
    if (!r || !r.isAgari) return 'noten';
    if (!(r.yakuman > 0 || r.han >= 1)) return 'no-yaku';
    if (!this.winMeetsFloor(r)) return 'shibari';
    void seat;
    return null;
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
    const dora = isRiichi ? this.ctx.baseDora().concat(this.ctx.uraDora()) : this.ctx.baseDora();
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
    console.log(
      `[bridge] ${code}: match start (seed=${this.seed} powers=${[0, 1, 2, 3].map((s) => this.powerOf(s)).join(',')})`
    );
    let handsPlayed = 0;
    while (!this.matchOver && (this.kyoku < this.totalRounds || this.overtime)) {
      if (++handsPlayed > 200) {
        console.error('[bridge] safety: too many hands');
        break;
      }
      await this.playOneHand();
    }
    // Any riichi sticks still uncollected on the table at match end are LOST, and
    // deliberately not paid out. This matches the standard rules — the World
    // Riichi Championship rules state outright that "riichi deposits remaining on
    // the table at the end of the hanchan are lost" — and it is what engine/game.js
    // `main()` does, so the two rule front-ends agree (see docs/known-issues.md,
    // KI-18, which records why this was briefly the other way round).
    //
    // The consequence, which callers must handle: `GameOver.final_scores` sums to
    // 100 000 *minus* whatever was left on the table. Do not assert an exact total
    // across a finished match; assert `100000 - leftover`.
    if (this.riichiCarry > 0) {
      console.log(`[bridge] ${this.riichiCarry / 1000} uncollected riichi stick(s) forfeited at match end`);
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
        try {
          state.powers.register(s, ROSTERS[power](s, this.persistentPowerState[s]));
        } catch (e) {
          warnOnce('register:' + power, e);
        }
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

    const initialIndicators = MF.doraIndicatorSlots(0);
    const ctx = {
      state,
      players,
      dead,
      dealer,
      bakaze: bakazeNum,
      doraInd: [dead[initialIndicators.dora]],
      uraInd: [dead[initialIndicators.ura]],
      kanCount: 0,
      rinshanIdx: 0,
      callsMade: 0,
      drawsThisKyoku: 0,
      kansBy: [0, 0, 0, 0],
      firstLapDiscards: [], // suufon-renda: first discard of each seat while no call made
      suufonDone: false,
      fourRiichiPending: false, // set on the 4th riichi; abort after its discard goes unclaimed
      riichiPool: this.riichiCarry,
      poolTotal: () => state.pool.total(),
      baseDora: () => ctx.doraInd.map(DORA_NEXT),
      uraDora: () => ctx.uraInd.map(DORA_NEXT),
      revealKanDora: () => {
        ctx.kanCount++;
        const slots = MF.doraIndicatorSlots(ctx.kanCount);
        if (slots.revealed) {
          ctx.doraInd.push(dead[slots.dora]);
          ctx.uraInd.push(dead[slots.ura]);
        }
        // Keep state.doraIndicators in step with ctx (powers score against it).
        state.doraIndicators = [...ctx.doraInd];
        this.broadcast(P.evDoraIndicatorsUpdated({ doraIndicators: P.tilesToProtocol(ctx.doraInd) }));
      },
    };
    this.riichiCarry = 0;
    this.ctx = ctx;
    this.clearMailbox();

    for (let s = 0; s < 4; s++) {
      const p = players[s];
      this.room.sendTo(
        s,
        P.event(
          P.evGameStarted({
            seatWind: P.seatWind(s, dealer),
            hand: P.tilesToProtocol([...p.hand]),
            scores: [...this.scores],
            roundWind: P.WINDS[bakazeNum - 1],
            doraIndicators: P.tilesToProtocol(ctx.doraInd),
            roundNumber: kyoku,
            totalRounds: this.totalRounds,
            honba: this.honba,
            riichiSticks: ctx.riichiPool / 1000,
            threePlayer: false,
            nukiDora: false,
          })
        )
      );
    }
    this.broadcastPowerStatus();
    console.log(
      `[bridge] ${this.room.code}: hand kyoku=${kyoku} honba=${this.honba} dealer=P${dealer} dora=${ctx.doraInd.map(norm).join(',')}`
    );

    let winner = -1;
    let winBy = null;
    let outcome;
    const playedKyoku = kyoku;
    const kyuushuSeat = this.checkKyuushu();
    if (kyuushuSeat >= 0) {
      outcome = await this.abortHand('KyuushuKyuuhai', { declarer: kyuushuSeat });
    } else {
      let turn = dealer;
      let guard = 0;
      while (ctx.poolTotal() > 0) {
        if (++guard > 400) {
          console.error('[bridge] turn safety stop');
          break;
        }
        const out = await this.playTurn(turn);
        if (out.end) {
          winner = out.winner;
          winBy = out.winBy;
          break;
        }
        turn = out.next;
      }

      outcome =
        winBy && winBy.type === 'abort'
          ? await this.abortHand(winBy.reason, {})
          : winBy && winBy.type === 'chombo'
            ? await this.chomboHand(winBy.offender)
            : await this.finishHand(winner, winBy);
    }

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

    // Nagashi settles as wins but finishHand's winBy is null on that path, so
    // normalize here for the rotation + match-end decisions below.
    let flowWinBy = winBy;
    let flowWinner = winner;
    const nagSeats = outcome.nagashiSeats || [];
    if (nagSeats.length) {
      flowWinBy = { type: 'nagashi', hits: nagSeats.map((seat) => ({ seat })) };
      flowWinner = nagSeats[0];
    }
    const keepDealer = this.applyPostSettlementFlow({ outcome, winBy: flowWinBy, winner: flowWinner, dealer });
    if (!keepDealer) this.dealer = (this.dealer + 1) % 4;
    this.kyoku++;

    if (!outcome.aborted && !outcome.chombo) {
      const wSeats =
        flowWinBy && flowWinBy.type === 'tsumo'
          ? [flowWinner]
          : flowWinBy && flowWinBy.hits
            ? flowWinBy.hits.map((h) => h.seat)
            : [];
      this.checkMatchEnd({
        keepDealer,
        dealerWon: wSeats.includes(dealer),
        dealer,
        allLast: !this.overtime && playedKyoku === this.totalRounds - 1,
      });
    }

    await this.waitForReady();
  }

  // Kyuushu-kyuuhai: a dealt 14-tile hand holding 9+ DISTINCT kinds of
  // terminals/honours may abort the deal. Seats are asked in turn order from
  // the dealer; CPU seats declare at the standard 0.8 rate (mirrors
  // engine/game.js). Human seats auto play on — there is no deal-time prompt
  // channel on the wire, so this is a documented limitation, not a silent
  // rule change. Returns the declaring seat or -1.
  checkKyuushu() {
    const ctx = this.ctx;
    if (!MF.abortEnabled(RULES.serverAborts, 'kyuushuKyuuhai')) return -1;
    for (let k = 0; k < 4; k++) {
      const s = (ctx.dealer + k) % 4;
      if (H.distinctYaochuu(ctx.players[s].hand) >= 9) {
        if (this.isCpuSeat(s)) {
          if (this.decide.next() < 0.8) {
            console.log(`[bridge] P${s} declares KYUUSHU-KYUUHAI - abortive draw`);
            return s;
          }
          console.log(`[bridge] P${s} holds 9+ distinct terminals/honours but plays on`);
        } else {
          console.log(`[bridge] P${s} holds 9+ distinct terminals/honours (human auto plays on: no deal prompt)`);
        }
      }
    }
    return -1;
  }

  // Shared abortive-draw settlement: void hand, no payments, sticks carry,
  // dealer repeats with +1 honba. Triple ron delegates here; so do the four
  // newly-wired aborts (kyuushu/suufon/suucha/suukaikan) via playOneHand.
  async abortHand(reason, { declarer = null } = {}) {
    const ctx = this.ctx;
    this.riichiCarry = ctx.riichiPool;
    ctx.riichiPool = 0;
    this.broadcast(
      P.evRoundDraw({
        scores: [...this.scores],
        reason,
        tenpai: [],
        riichiSticks: this.riichiCarry / 1000,
        playerHands: this.playerHandsInfo(),
        declarer,
      })
    );
    console.log(`[bridge] ABORTIVE ${reason} - hand void, no payments`);
    return { aborted: true };
  }

  // Chombo settlement: the offender pays every other seat a mangan tsumo
  // (honba ignored, shared match-flow arithmetic), sticks carry, and the hand
  // replays with the dealer repeating and honba unchanged. Mirrors
  // engine/game.js, where an illegal ankan after riichi is a mangan penalty.
  async chomboHand(offender) {
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      if (i === offender) continue;
      const pay = MF.manganPayment(offender, i, ctx.dealer);
      this.scores[i] += pay;
      this.scores[offender] -= pay;
    }
    this.riichiCarry = ctx.riichiPool;
    ctx.riichiPool = 0;
    this.broadcast(
      P.evRoundDraw({
        scores: [...this.scores],
        reason: `Chombo (P${offender})`,
        tenpai: [],
        riichiSticks: this.riichiCarry / 1000,
        playerHands: this.playerHandsInfo(),
        declarer: offender,
      })
    );
    console.log(`[bridge] CHOMBO P${offender} - mangan penalty, hand replays`);
    return { chombo: true };
  }

  // First-lap abort check, called when a discard goes fully unclaimed (no ron,
  // no pon/chi/kan). Suucha-riichi (all four riichi) aborts on that discard;
  // suufon-renda aborts when the accumulated first discards are one wind four
  // times AND nobody called. Returns the reason or null. Ron precedence is
  // structural: ron wins return before this is ever consulted.
  //
  // The `callsMade === 0` guard is the rule, not a shortcut: a call on the 4th
  // first-lap discard voids suufon, and without the guard the already-full
  // accumulator would fire on a later quiet discard. engine/game.js uses the
  // same ordering (after its call window), so the two front-ends now agree.
  checkLapAbort() {
    const ctx = this.ctx;
    if (ctx.fourRiichiPending) {
      ctx.fourRiichiPending = false;
      if (MF.abortEnabled(RULES.serverAborts, 'suuchaRiichi')) return 'SuuchaRiichi';
    }
    // Defensive: older headless scaffolds (and any future partial ctx) may not
    // carry the first-lap accumulator. Missing means "no information", never abort.
    const firstLap = Array.isArray(ctx.firstLapDiscards) ? ctx.firstLapDiscards : [];
    if (!ctx.suufonDone && ctx.callsMade === 0 && firstLap.length === 4) {
      ctx.suufonDone = true;
      if (MF.abortEnabled(RULES.serverAborts, 'suufonRenda') && H.isSuufonRenda(firstLap)) {
        return 'SuufonRenda';
      }
    }
    return null;
  }

  // Match-end gate for all-last and enchousen. Agari-yame: a dealer who won
  // the all-last hand while strictly leading ends the match immediately
  // (humans auto-end; there is no renchan prompt on the wire). Otherwise a
  // kept deal at all-last opens enchousen; overtime hands continue while the
  // dealer repeats and the match ends on the first rotation.
  checkMatchEnd({ keepDealer, dealerWon, dealer, allLast }) {
    if (allLast) {
      if (dealerWon && MF.dealerLeads(this.scores, dealer)) {
        console.log('[bridge] AGARI-YAME: leading dealer ends the match');
        this.matchOver = true;
        return;
      }
      if (keepDealer && !this.overtime) {
        this.overtime = true;
        console.log('[bridge] ENCHOUSEN (overtime): dealer continues past all-last');
      }
      return;
    }
    if (this.overtime && !keepDealer) {
      console.log('[bridge] ENCHOUSEN over: dealer failed to repeat - match over');
      this.matchOver = true;
    }
  }

  /**
   * Decide the honba count and whether the dealer repeats, once a hand has been
   * settled. Returns true if the dealer keeps the deal.
   *
   * Extracted from playOneHand because this decision had a bug that finishHand-level
   * tests structurally could not see: the block used to re-derive the riichi carry
   * from `ctx.riichiPool` *after* finishHand had already zeroed it, which silently
   * destroyed the sticks left on a drawn hand. Nothing caught it except the bridge
   * E2E test, intermittently, because it is seeded from Math.random(). Its own note
   * said as much. The rule "finishHand owns the carry" is now enforced here, in a
   * method that can be called directly.
   *
   * Takes a single object, NOT positional arguments. The four inputs are two seat
   * numbers, a settlement descriptor and an outcome descriptor; with positional args a
   * dropped argument at the call site silently shifted `dealer` to `undefined`, which
   * made `dealerWon` and `tenpaiSeats().includes(dealer)` false for every hand — the
   * dealer could never keep the deal. Every unit test here passed while it did,
   * because they all called the method directly rather than through playOneHand.
   * See the "playOneHand -> dealer rotation" block in server/test/settlement.test.js
   * for the tests that close that seam.
   */
  applyPostSettlementFlow({ outcome, winBy, winner, dealer }) {
    // Shared transition table (engine/match-flow.js): same dealer/honba/kyoku
    // decision as the offline game.js loop. Normalizes the table's winBy
    // shapes (tsumo seat / ron hits[].seat) into winnerSeats first.
    const chombo = Boolean(outcome && outcome.chombo);
    let win = null;
    if (!chombo && winBy !== null && winBy !== undefined) {
      const winnerSeats = winBy.type === 'tsumo' ? [winner] : (winBy.hits || []).map((h) => h.seat);
      win = { type: winBy.type, winnerSeats };
    }
    const flow = MF.postHandFlow({
      aborted: Boolean(outcome && outcome.aborted),
      chombo,
      win,
      tenpaiSeats: win || chombo ? [] : this.tenpaiSeats(),
      dealer,
    });
    if (flow.honba === 'increment') this.honba++;
    else if (flow.honba === 'reset') this.honba = 0;
    // 'keep' (chombo) leaves honba unchanged.
    if (flow.kyokuRepeat) this.kyoku--;
    // Exhaustive draw. The riichi carry is NOT touched here: finishHand has already
    // moved ctx.riichiPool onto this.riichiCarry. Re-deriving it would overwrite a
    // real carry with 0 — see the note above.
    return flow.keepDealer;
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

  // A 13-tile view of a seat's concealed hand. Mid-turn the hand holds the
  // just-drawn tile (14 tiles). Waits/furiten are a 13-tile property: passing
  // the 14-tile hand to getWaits made it test a 15-tile agari (never valid), so
  // getWaits returned [] and furiten was never reported to the client.
  concealed13(me) {
    if (me.hand.length < 14 || me.lastDrawn === null) return me.hand;
    const out = [...me.hand];
    const i = out.findIndex((x) => same(x, me.lastDrawn));
    if (i >= 0) out.splice(i, 1);
    return out;
  }

  furitenNow(me) {
    const waits = H.getWaits({ ...me, hand: this.concealed13(me) }, this.ctx.players, this.ctx.dead, {
      dora: [],
      bakaze: this.ctx.bakaze,
      jikaze: P.jikazeOf(me.seat, this.ctx.dealer),
    });
    // Temp (passed-ron) furiten blocks ron just like discard furiten; tryRon
    // enforces both, so the indicator must reflect both.
    return me.tempFuriten === true || H.isDiscardFuriten(me, waits);
  }

  // Opt-in tile-conservation guard (`SAKI_INVARIANTS=1`). Development assertion,
  // not a rule: off by default so it can never gate a live game. The live wall
  // is an inventory (`state.pool`), so `DynamicPool.audit` folds in the pool
  // counts and reserved slots; we contribute hands/melds/discards plus the
  // wanpai slots not yet drawn out. See engine/invariants.js `wanpaiPartition`.
  assertConserved(where) {
    if (!process.env.SAKI_INVARIANTS) return;
    const { players, dead, rinshanIdx, state } = this.ctx;
    if (!state || !state.pool || typeof state.pool.audit !== 'function') return; // unit-test tables
    const problems = state.pool.audit(wanpaiPartition(players, [], dead, rinshanIdx));
    if (problems.length) throw new Error(`tile conservation broke ${where}: ${problems.join('; ')}`);
  }

  // The character turn-clock hook (getTurnClock, conventions.md phase 2c). The
  // dispatcher supplies a 10s default; sanitise here so a hook that returns junk
  // can never starve or freeze a human's turn.
  turnClockFor(seat) {
    let seconds = 10;
    const powers = this.ctx.state && this.ctx.state.powers;
    if (powers && typeof powers.getTurnClock === 'function') {
      seconds = powers.getTurnClock(seat, this.ctx.state);
    }
    return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 10;
  }

  tenpaiSeats() {
    const c = this.ctx;
    return [0, 1, 2, 3].filter(
      (s) =>
        H.getWaits(c.players[s], c.players, c.dead, { dora: [], bakaze: c.bakaze, jikaze: P.jikazeOf(s, c.dealer) })
          .length > 0
    );
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
    const tsumoScore = this.scoreFor(seat, drawn, tsumoFlagsThis);
    const wantTsumo = this.isAWin(tsumoScore) && this.winMeetsFloor(tsumoScore);
    const tsumoReason = wantTsumo ? null : this.tsumoBlockReason(seat, tsumoScore);
    if (!wantTsumo && tsumoReason && tsumoReason !== 'noten') {
      // Only noisy when the shape is complete but unwinable: that is the
      // "I have yaku but cannot tsumo" / "I am tenpai but cannot win" confusion.
      // Log full context so a report (e.g. open haku pon) is reproducible.
      try {
        console.log(
          `[bridge] P${seat} tsumo blocked (${tsumoReason}): hand=${JSON.stringify(me.hand)} melds=${JSON.stringify(me.melds)} drawn=${drawn} score=${JSON.stringify({ isAgari: tsumoScore && tsumoScore.isAgari, han: tsumoScore && tsumoScore.han, yakuman: tsumoScore && tsumoScore.yakuman, yaku: tsumoScore && tsumoScore.yaku })}`
        );
      } catch (e) {
        warnOnce('tsumo-block-log', e);
      }
    }

    // ---- emit draw events ----
    this.room.sendTo(
      seat,
      P.event(
        P.evTileDrawn({
          tile: P.sakiToTile(drawn),
          remaining: ctx.poolTotal(),
          canTsumo: wantTsumo,
          canTsumoReason: tsumoReason,
          canRiichi: this.canRiichiNow(me),
          isFuriten: this.furitenNow(me),
        })
      )
    );
    for (let s = 0; s < 4; s++) {
      if (s !== seat) {
        this.room.sendTo(
          s,
          P.event(
            P.evOtherPlayerDrew({
              player: P.seatWind(seat, ctx.dealer),
              remaining: ctx.poolTotal(),
            })
          )
        );
      }
    }

    // ---- kan availability (own hand, shared with the CLI) ----
    const kan = TC.kanOptions(me, { kanCount: ctx.kanCount, rinshanIdx: ctx.rinshanIdx });
    const ankanTile = kan.ankanTile;
    const ponUp = kan.ponUp;
    let kanChoice = null;
    if (kan.canKan) {
      if (me.isCpu) {
        const r1 = this.decide.next();
        if (ankanTile && r1 < 0.5) {
          if (!me.riichi || H.ankanKeepsWaits(me, ankanTile)) kanChoice = { kind: 'ankan', tile: ankanTile };
        } else if (ponUp && this.decide.next() < 0.35) {
          // Kakan while in riichi is never legal (it moves a tile out of the
          // concealed hand and can change the wait). Bots bypass validateAct, so
          // the rule has to be enforced here as well as in classifyHumanKan.
          if (me.riichi) console.log(`[bridge] P${seat} skips KAKAN (illegal while in riichi)`);
          else kanChoice = { kind: 'kakan', tile: kan.kakanTile };
        }
      }
    }

    // ---- decide action ----
    let action;
    if (!me.isCpu) {
      // Character turn clock (getTurnClock, phase 2c): the client renders and
      // enforces this locally; the server sends it once per turn, before the
      // action request opens.
      this.room.sendTo(seat, P.turnTimer(this.turnClockFor(seat)));
      // Human: wait for Discard / Riichi / Tsumo / Kan (client-computed hints).
      for (;;) {
        const a = await this.request(seat, new Set(['Discard', 'Riichi', 'Tsumo', 'Kan', 'Pass']));
        if (a.type === 'Kan' && !kanChoice) {
          const classified = this.classifyHumanKan(seat, a.tile_index);
          if (classified) {
            const kanTimeout =
              ctx.kanCount < RULES.maxKan && ctx.rinshanIdx < RULES.rinshanSlots ? null : 'kan limit reached';
            if (kanTimeout) {
              this.sendError(seat, 'InvalidAction', kanTimeout);
              continue;
            }
            // valid: wrapped in act below
            a.kan = classified;
          } else {
            this.sendError(seat, 'InvalidAction', 'kan not possible');
            continue;
          }
        }
        const v = this.validateAct(seat, a, { wantTsumo, firstDraw, isLastDraw });
        if (v.ok) {
          action = v.action;
          break;
        }
        this.sendError(seat, 'InvalidAction', v.reason);
      }
    } else {
      action = this.botDecision(seat, me, {
        kanChoice,
        wantTsumo,
        ankanTile,
        ponUp,
        firstDraw: this.isFirstDraw(me),
        isLastDraw,
      });
      if (action.type === 'Kan') action.kan = kanChoice;
      await botWait(turnStartTime);
    }

    // ---- dispatch ----
    if (action.type === 'Tsumo') {
      const claim = this.scoreFor(seat, me.lastDrawn, tsumoFlagsThis);
      if (this.isAWin(claim) && this.winMeetsFloor(claim)) {
        return {
          end: true,
          winner: seat,
          winBy: {
            type: 'tsumo',
            seat,
            winTile: me.lastDrawn,
            rinshan: false,
            haitei: isLastDraw,
            first: firstDraw,
          },
        };
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
        dora: [],
        bakaze: ctx.bakaze,
        jikaze: P.jikazeOf(seat, ctx.dealer),
      });
    }

    if (ctx.state.powers) {
      // Only the seat whose turn just ended ticks its durations. Firing this for
      // all four seats on every discard expired per-turn tier buffs ~4x too fast
      // (a "next 3 turns" buff was worth about one turn). The engine sim calls
      // onTurnEnd for the acting seat only, which is the semantics to match.
      const h = ctx.state.powers.hooksFor(seat);
      if (h && typeof h.onTurnEnd === 'function') {
        try {
          h.onTurnEnd(ctx.state);
        } catch (e) {
          warnOnce('onTurnEnd', e);
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
    this.scores[seat] -= RULES.riichiValue;
    ctx.riichiPool += RULES.riichiValue;
    if (ctx.players.every((p) => p.riichi)) {
      // Suucha-riichi: all four declared. The abort fires after this discard
      // goes unclaimed (checked on the quiet path out of resolveCallWindow).
      ctx.fourRiichiPending = true;
      console.log('[bridge] SUUCHA-RIICHI pending: all four riichi');
    }
    this.broadcast(
      P.evPlayerRiichi({
        player: P.seatWind(seat, ctx.dealer),
        scores: [...this.scores],
        riichiSticks: ctx.riichiPool / 1000,
      })
    );
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
    this.assertConserved(`after seat ${seat} discarded ${removed}`);
    // Suufon-renda accumulator: first discard of each seat while no call has
    // been made yet. Mirrors engine/game.js firstLapDiscards.
    if (ctx.callsMade === 0 && me.discards.length === 1 && !ctx.suufonDone) {
      ctx.firstLapDiscards.push(removed);
    }
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
      } catch (e) {
        warnOnce('onDiscard', e);
      }
    }

    this.broadcast(
      P.evTileDiscarded({
        player: P.seatWind(seat, ctx.dealer),
        tile: P.sakiToTile(removed),
        is_tsumogiri: isTsumogiri,
        hand_index: handIndex,
      })
    );
    this.broadcastPowerStatus();
    return { tile: removed, isTsumogiri };
  }

  classifyHumanKan(seat, tileIndex) {
    const me = this.ctx.players[seat];
    // Adding a kan to an existing pon moves a tile out of the concealed hand and
    // into the meld, which can change the wait. Standard riichi forbids it
    // outright while in riichi — unlike ankan, which is legal if the waits are
    // unchanged. A riichi hand has no pon, so this is defensive; game.js also
    // refuses it rather than treating it as a chombo.
    const kakanForbidden = me.riichi
      ? { error: true, reason: 'cannot add a kan to a pon while in riichi - choose another tile' }
      : null;

    if (tileIndex !== undefined && tileIndex !== null && tileIndex >= 0) {
      const tileCode = P.tileToSaki({ index: tileIndex, red_dora: false });
      if (tileCode) {
        const k = norm(tileCode);
        const c = me.hand.filter((x) => norm(x) === k).length;
        if (c === 4) {
          if (me.riichi && !H.ankanKeepsWaits(me, k)) {
            // Illegal but declarable: the player may chombo. doOwnKan warns
            // them, charges the mangan penalty and replays the hand (game.js
            // offers the same "declare anyway" choice).
            return { kind: 'ankan', tile: k, chombo: true };
          }
          return { kind: 'ankan', tile: k };
        }
        const pon = me.melds.find((m) => m.type === 'pon' && norm(m.tiles[0]) === k);
        if (pon && c >= 1) return kakanForbidden || { kind: 'kakan', tile: k };
      }
    }

    // Auto-detect available ankan or kakan from hand and melds
    const cnt = {};
    for (const x of me.hand) {
      const k = norm(x);
      cnt[k] = (cnt[k] || 0) + 1;
    }
    const ankanTile = Object.keys(cnt).find((k) => cnt[k] === 4);
    if (ankanTile) {
      if (me.riichi && !H.ankanKeepsWaits(me, ankanTile)) {
        // Same declarable chombo as the tile-index path above (unknown waits
        // fail into this branch too, so a missing snapshot cannot silently
        // legalise the kan).
        return { kind: 'ankan', tile: ankanTile, chombo: true };
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
    const { firstDraw, isLastDraw } = opts;
    if (a.type === 'Tsumo') {
      const claim = this.scoreFor(seat, me.lastDrawn, { tsumo: true, kan: false, last: isLastDraw, tenhou: firstDraw });
      if (!this.isAWin(claim) || !this.winMeetsFloor(claim)) {
        const why = this.tsumoBlockReason(seat, claim);
        return {
          ok: false,
          reason:
            why === 'no-yaku'
              ? 'tsumo not available (complete but no yaku)'
              : why === 'shibari'
                ? 'tsumo not available (ryanhan-shibari: needs 2+ han)'
                : why === 'noten'
                  ? 'tsumo not available (hand not complete)'
                  : 'tsumo not available',
        };
      }
      return { ok: true, action: a };
    }
    if (a.type === 'Kan') {
      const k = a.kan;
      if (!k) return { ok: false, reason: 'kan not possible' };
      if (k.error) return { ok: false, reason: k.reason || 'illegal kan - choose another tile' };
      // k.chombo (wait-changing ankan after riichi) is deliberately accepted
      // here: doOwnKan warns and settles it as a mangan penalty + replay.
      // Defence in depth: classifyHumanKan already refuses kakan while in riichi,
      // but the rule is cheap enough to assert again at the boundary.
      if (k.kind === 'kakan' && me.riichi) {
        return { ok: false, reason: 'cannot add a kan to a pon while in riichi' };
      }
      if (this.ctx.kanCount >= RULES.maxKan || this.ctx.rinshanIdx >= RULES.rinshanSlots)
        return { ok: false, reason: 'no kan slots left' };
      return {
        ok: true,
        action: { type: 'Kan', kan: k, tile: k.tile },
      };
    }
    if (a.type === 'Riichi') {
      if (me.riichi) return { ok: false, reason: 'already riichi' };
      if (!me.melds.every((m) => !m.open)) return { ok: false, reason: 'open hand - riichi not allowed' };
      if (!H.canRiichi(this.scores[seat], this.ctx.poolTotal()))
        return { ok: false, reason: 'riichi needs 1000 pts and 4+ wall tiles' };
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
      if (
        H.shantenOf(me.hand.filter((_, j) => j !== di)) === 0 &&
        H.canRiichi(this.scores[seat], this.ctx.poolTotal())
      ) {
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

    // Illegal ankan after riichi: allowed, but it is a chombo. Warn, then settle
    // the mangan penalty and replay — the same choice game.js offers the human.
    // The kan is NOT applied (game.js breaks before moving any tiles).
    if (kan.chombo) {
      const msg = `chombo: ankan ${tile} after riichi changes your waits - mangan penalty, hand replays`;
      console.log(`[bridge] P${seat} ${msg}`);
      this.sendError(seat, 'Chombo', msg);
      return { end: true, winner: -3, winBy: { type: 'chombo', offender: seat } };
    }

    if (kan.kind === 'kakan') {
      const hits = await this.collectRon(tile, seat, { chankan: true, label: 'CHANKAN' });
      if (MF.abortEnabled(RULES.serverAborts, 'tripleRon') && hits.length >= 3) {
        return { end: true, winner: -1, winBy: { type: 'abort', reason: 'TripleRon' } };
      }
      if (hits.length) {
        return {
          end: true,
          winner: hits[0].seat,
          winBy: { type: 'ron', from: seat, hits, tile, flags: { chankan: true } },
        };
      }
      const pm = me.melds.find((m) => m.type === 'pon' && same(m.tiles[0], tile));
      const i = me.hand.findIndex((x) => same(x, tile));
      if (i < 0 || !pm) return { end: false, next: (seat + 1) % 4 };
      pm.tiles.push(me.hand.splice(i, 1)[0]);
      pm.type = 'kakan';
      this.broadcast(
        P.evPlayerCalled({
          player: P.seatWind(seat, ctx.dealer),
          callType: 'Kakan',
          calledTile: P.sakiToTile(tile),
          tiles: P.tilesToProtocol(pm.tiles),
        })
      );
    } else {
      const tiles = [];
      for (let c = 0; c < 4; c++) {
        const i = me.hand.findIndex((x) => same(x, tile));
        if (i < 0) return { end: false, next: (seat + 1) % 4 };
        tiles.push(me.hand.splice(i, 1)[0]);
      }
      me.melds.push({ tiles, open: false, type: 'ankan' });
      this.broadcast(
        P.evPlayerCalled({
          player: P.seatWind(seat, ctx.dealer),
          callType: 'Ankan',
          calledTile: P.sakiToTile(tile),
          tiles: P.tilesToProtocol(tiles),
        })
      );
    }
    ctx.callsMade++;
    H.clearAllIppatsu(ctx.players);
    ctx.kansBy[seat]++;
    // Suukaikan: four kans split across seats aborts the hand (a solo quad
    // plays on). Mirrors engine/game.js via the shared H.isSuukaikanAbort.
    // Checked BEFORE the kan-dora flip so an aborting 4th kan does not reveal
    // a dora and then discard the hand.
    if (MF.abortEnabled(RULES.serverAborts, 'suukaikan') && H.isSuukaikanAbort(ctx.kansBy)) {
      console.log(`[bridge] SUUKAIKAN (four kans: ${ctx.kansBy.join('/')}) - abortive draw`);
      return { end: true, winner: -1, winBy: { type: 'abort', reason: 'Suukaikan' } };
    }

    if (ctx.state.powers && typeof ctx.state.powers.broadcastPlayerKan === 'function') {
      ctx.state.powers.broadcastPlayerKan(seat, ctx.state);
    }
    // Run the kan power hook BEFORE flipping the kan dora, so a seeding power
    // (Saki's kan-dora seed) can swap the indicator that is about to be
    // revealed. kanCount is the TOTAL kan index revealKanDora will use
    // (ctx.kanCount + 1), not the per-seat count — otherwise kans split across
    // seats seed the wrong dead-wall slot.
    if (this.powerOf(seat) !== 'none') {
      this.maybeActivateTier(seat, ctx.kanCount + 1);
    }
    ctx.revealKanDora();

    const rt = ctx.dead[ctx.rinshanIdx++];
    if (rt === undefined) return { end: true, winner: -1, winBy: null };
    me.hand.push(rt);
    me.lastDrawn = rt;
    H.clearTempFuritenOnDraw(me); // a kan draw is still a draw

    const trs = this.scoreFor(seat, rt, { tsumo: true, kan: true, last: false, tenhou: false });
    const wantTsumo = this.isAWin(trs) && this.winMeetsFloor(trs);
    const tsumoReason = wantTsumo ? null : this.tsumoBlockReason(seat, trs);

    // Emit Rinshan draw events
    this.room.sendTo(
      seat,
      P.event(
        P.evTileDrawn({
          tile: P.sakiToTile(rt),
          remaining: ctx.poolTotal(),
          canTsumo: wantTsumo,
          canTsumoReason: tsumoReason,
          canRiichi: false,
          isFuriten: this.furitenNow(me),
        })
      )
    );
    for (let s = 0; s < 4; s++) {
      if (s !== seat) {
        this.room.sendTo(
          s,
          P.event(
            P.evOtherPlayerDrew({
              player: P.seatWind(seat, ctx.dealer),
              remaining: ctx.poolTotal(),
            })
          )
        );
      }
    }

    if (wantTsumo && me.isCpu) {
      const result = { type: 'tsumo', winner: seat, tag: 'RINSHAN' };
      this.settlePowerHook(result);
      return {
        end: true,
        winner: seat,
        winBy: { type: 'tsumo', seat, winTile: rt, rinshan: true, haitei: false, first: false },
      };
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
      const activation = callHook(hooks, 'onTurnStart', state, { type: 'normal', armedTier: 0 });
      if (activation && activation.activated) {
        const eventType =
          (activation.event && activation.event.type) ||
          (activation.result && activation.result.event && activation.result.event.type) ||
          'NORMAL_TRIGGER';
        console.log(`[bridge] normal power ${power} triggered ${eventType} for seat ${seat}`);
        this.broadcast(
          P.evPowerActivated({
            player: P.seatWind(seat, ctx.dealer),
            power,
            tier: 0,
            eventType,
          })
        );
        this.broadcastPowerStatus();
      }
      return;
    }

    if (power === 'saki') return; // flow Saki is kan-only

    // Human player uses explicitly armed tier (0 = conserve/off); CPU defaults to 'auto'
    const armedTier = this.isCpuSeat(seat) ? 'auto' : this.armedTiers[seat] || 0;
    if (armedTier === 0) return;

    let activation = null;
    if (typeof hooks.onTurnStart === 'function') {
      activation = callHook(hooks, 'onTurnStart', state, { armedTier });
    } else {
      const order = armedTier === 'auto' ? [4, 3, 2, 1] : [armedTier];
      for (const t of order) {
        const fnName = `tryActivateTier${t}`;
        if (typeof hooks[fnName] === 'function') {
          try {
            const r = hooks[fnName].call(hooks, state);
            if (r && r.ok) {
              activation = { activated: true, tier: t, result: r };
              break;
            }
          } catch (e) {
            warnOnce(`tryActivateTier${t}`, e);
          }
        }
      }
    }

    if (activation && activation.activated) {
      const tier = activation.tier;
      const eventType =
        (activation.result && activation.result.event && activation.result.event.type) || `TIER_${tier}`;
      console.log(`[bridge] ${power} activated ${eventType} (Tier ${tier}) for seat ${seat}`);
      this.broadcast(
        P.evPowerActivated({
          player: P.seatWind(seat, ctx.dealer),
          power,
          tier,
          eventType,
        })
      );
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
    // Power hooks score with state.bakaze/state.doraIndicators/p.wind, but the
    // bridge keeps those on ctx (ctx.bakaze/ctx.doraInd/dealer). Sync them so
    // winningWaits sees the real round wind, seat wind and dora (matters for
    // the overtime ryanhan floor, and avoids wind-yakuhai skew).
    try {
      state.bakaze = ctx.bakaze;
      state.doraIndicators = [...ctx.doraInd];
      if (state.players && state.players[seat]) state.players[seat].wind = P.jikazeOf(seat, ctx.dealer);
    } catch (e) {
      warnOnce('kan-ctx-sync', e);
    }

    // Normal-type powers need no arming and spend nothing: the hook evaluates
    // its own condition and pins the on-deck replacement slot when it fires.
    if (type === 'normal') {
      const activation = callHook(hooks, 'onKanDeclared', state, {
        kanCount,
        rinshanIdx: ctx.rinshanIdx,
        armedTier: 0,
      });
      if (activation && activation.activated) {
        const eventType =
          (activation.event && activation.event.type) ||
          (activation.result && activation.result.event && activation.result.event.type) ||
          'NORMAL_KAN';
        console.log(`[bridge] normal power ${power} triggered ${eventType} (kan ${kanCount})`);
        this.broadcast(
          P.evPowerActivated({
            player: P.seatWind(seat, ctx.dealer),
            power,
            tier: 0,
            eventType,
          })
        );
        this.broadcastPowerStatus();
      }
      return;
    }

    // Human player uses explicitly armed tier (or 'auto' if CPU)
    const armedTier = this.isCpuSeat(seat) ? 'auto' : this.armedTiers[seat] || 0;
    if (armedTier === 0) return; // Conserve meter on Kan!

    let activation = null;
    if (typeof hooks.onKanDeclared === 'function') {
      activation = callHook(hooks, 'onKanDeclared', this.ctx.state, {
        armedTier,
        kanCount,
        rinshanIdx: this.ctx.rinshanIdx,
      });
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
          } catch (e) {
            warnOnce(`${power}:onKanDeclared`, e);
          }
        }
      }
    }

    if (activation && activation.activated) {
      const r = activation.result;
      const tier = activation.tier;
      // Saki tiers now deterministically pin the on-deck slot (win if live,
      // else best ukeire). Only fall back to weighted sampling when the hook
      // did NOT pin — never overwrite a guaranteed slot.
      if (
        r &&
        !r.pinned &&
        r.weightOf &&
        typeof core.sampleRinshan === 'function' &&
        this.ctx.rinshanIdx < RULES.rinshanSlots
      ) {
        core.sampleRinshan(this.ctx.state, this.ctx.rinshanIdx, r.weightOf);
      }
      console.log(`[bridge] ${power} tier ${tier} activated (kan ${kanCount})`);
      const eventType = (r && r.event && r.event.type) || `TIER_${tier}`;
      this.broadcast(
        P.evPowerActivated({
          player: P.seatWind(seat, this.ctx.dealer),
          power,
          tier,
          eventType,
        })
      );
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
    } catch (e) {
      warnOnce('onSettlement', e);
    }
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
          if (!this.isAWin(r) || !this.winMeetsFloor(r)) {
            const why = this.tsumoBlockReason(seat, r);
            this.sendError(
              seat,
              'InvalidAction',
              why === 'no-yaku'
                ? 'tsumo not available (complete but no yaku)'
                : why === 'shibari'
                  ? 'tsumo not available (ryanhan-shibari: needs 2+ han)'
                  : why === 'noten'
                    ? 'tsumo not available (hand not complete)'
                    : 'tsumo not available'
            );
            continue;
          }
          const result = { type: 'tsumo', winner: seat, tag: 'RINSHAN' };
          this.settlePowerHook(result);
          return {
            end: true,
            winner: seat,
            winBy: { type: 'tsumo', seat, winTile: me.lastDrawn, rinshan: true, haitei: false, first: false },
          };
        }
        if (a.type !== 'Discard') {
          this.sendError(seat, 'InvalidAction', 'must discard after a call');
          continue;
        }
        if (banned.some((b1) => a.tile && norm(b1) === norm(a.tile))) {
          this.sendError(seat, 'InvalidAction', `kuikae: ${a.tile} is illegal after this call`);
          continue;
        }
        if (a.tile === null) {
          this.sendError(seat, 'InvalidAction', 'no drawn tile to discard');
          continue;
        }
        if (!me.hand.some((x) => x === a.tile || norm(x) === norm(a.tile))) {
          this.sendError(seat, 'InvalidAction', 'tile not in hand');
          continue;
        }
        // Riichi locks the hand: after a call/kan the drawn tile must be
        // discarded (tsumogiri). The turn path enforced this in validateAct,
        // but discardAfterCall has its own loop and skipped it.
        if (me.riichi && me.lastDrawn !== null && norm(a.tile) !== norm(me.lastDrawn)) {
          this.sendError(seat, 'InvalidAction', 'riichi player may only tsumogiri');
          continue;
        }
        action = a;
        break;
      }
    } else {
      const callStartTime = Date.now();
      const di = H.botDiscard(me.hand, !!me.riichi, banned, () => this.decide.next());
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

    // 1. Collect all valid call options for the other 3 seats. The rules for
    // which calls exist (riichi cannot call, the daiminkan needs three copies
    // and kan budget, chi is shimocha-only) live in engine/turn-core.js so the
    // CLI cannot drift from the server. `calls` is the wire shape only.
    const candidates = TC.callCandidates({
      from,
      tile,
      players,
      dead: ctx.dead,
      scoreCtxFor: (q) => this.shootCtx(q, flags.chankan, flags.houtei),
      // No enchousen gate until overtime opens; then ryanhan-shibari.
      // Reads RULES via match-flow so the floor cannot drift (game.js overtime).
      minHan: MF.minHan(this.overtime),
      chankan: !!flags.chankan,
      kanCount: ctx.kanCount,
      rinshanIdx: ctx.rinshanIdx,
    });

    const candidateMap = new Map();
    for (const c of candidates) {
      if (!TC.isCall(c)) continue;
      const calls = [];
      if (c.ron) calls.push('Ron');
      if (c.daiminkan) calls.push('Daiminkan');
      if (c.pon) calls.push({ Pon: { options: c.pon.map((pair) => pair.map(P.sakiToTile)) } });
      if (c.chi) {
        const suit = norm(tile)[1];
        calls.push({ Chi: { options: c.chi.map((o) => o.map((n) => P.sakiToTile(n + suit))) } });
      }
      c.calls = calls;
      candidateMap.set(c.seat, c);
    }

    if (candidateMap.size === 0) {
      this.phase = PHASE.TURN_ACT;
      // Fully unclaimed discard: the only place suucha-riichi and suufon-renda
      // can fire (ron/pon/chi claims return above with their own outcomes).
      const lapAbort = this.checkLapAbort();
      if (lapAbort) return { end: true, winner: -1, winBy: { type: 'abort', reason: lapAbort } };
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
            if (c.ron) res = { seat: q, type: 'Ron' };
            else if (c.daiminkan && this.decide.next() < 0.25) res = { seat: q, type: 'Kan' };
            else if (
              c.pon &&
              H.botWantsCall(H.shantenOf(qp.hand) - H.shantenOf(this.removeCopies(qp.hand, tile, 2)), false, () =>
                this.decide.next()
              )
            ) {
              res = { seat: q, type: 'Pon' };
            } else if (c.chi && this.decide.next() < 0.35) {
              const chosen = c.chi[Math.floor(this.decide.next() * c.chi.length)];
              res = { seat: q, type: 'Chi', tiles: chosen };
            } else {
              res = { seat: q, type: 'Pass' };
            }
          } else {
            this.room.sendTo(
              q,
              P.event(
                P.evCallAvailable({
                  tile: P.sakiToTile(tile),
                  discarder: P.seatWind(from, ctx.dealer),
                  calls: c.calls,
                })
              )
            );
            const allowed = new Set(['Pass']);
            if (c.ron) allowed.add('Ron');
            if (c.pon) allowed.add('Pon');
            if (c.daiminkan) allowed.add('Kan');
            if (c.chi) allowed.add('Chi');
            const action = await this.request(q, allowed);
            res = { seat: q, ...action };
          }

          if (resolved) return;
          results.push(res);
          pendingCount--;

          // If Ron was claimed and no other candidate can also Ron:
          const remainingCouldRon = candidateSeats.some(
            (s) => !results.some((r) => r.seat === s) && candidateMap.get(s)?.ron
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
            if (pendingCount === 0) {
              resolved = true;
              resolveAll(results);
            }
          }
        });
      }
    });

    // 3. Priority Arbitration. The rule lives in engine/turn-core.js: ron
    // wins, then the nearest pon/daiminkan, then chi. `responses` arrives in
    // response order, not turn order, so the helper ranks explicitly. It also
    // reports the candidates who could have ronned and passed, which is the
    // temporary-furiten rule.
    const verdict = TC.arbitrateCalls({ from, candidates: candidateMap, responses });
    for (const seat of verdict.passers) players[seat].tempFuriten = true;

    if (verdict.type === 'ron') {
      this.phase = PHASE.TURN_ACT;
      // Turn order also decides who collects the riichi sticks below, so hits
      // stay in turn order rather than response order.
      return {
        end: true,
        winner: verdict.claims[0].seat,
        winBy: { type: 'ron', from, hits: verdict.claims, tile, flags },
      };
    }

    if (verdict.type === 'pon' || verdict.type === 'daiminkan') {
      return await this.doOpenCall(verdict.seat, from, tile, verdict.type);
    }

    if (verdict.type === 'chi') {
      return await this.doOpenChi(verdict.seat, from, tile, verdict.tiles);
    }

    this.phase = PHASE.TURN_ACT;
    // Everyone passed: same quiet-discard case as the empty window above.
    const lapAbort = this.checkLapAbort();
    if (lapAbort) return { end: true, winner: -1, winBy: { type: 'abort', reason: lapAbort } };
    return null;
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
    this.broadcast(
      P.evPlayerCalled({
        player: P.seatWind(q, ctx.dealer),
        fromPlayer: P.seatWind(from, ctx.dealer),
        callType: kind === 'daiminkan' ? 'Daiminkan' : 'Pon',
        calledTile: P.sakiToTile(tile),
        tiles: P.tilesToProtocol(tiles),
      })
    );
    console.log(`[bridge] P${q} ${kind.toUpperCase()} ${tile}`);
    ctx.callsMade++;
    H.clearAllIppatsu(ctx.players);

    if (!qp.isCpu) {
      this.room.sendTo(q, P.event(P.evHandUpdated({ hand: P.tilesToProtocol([...qp.hand]) })));
    }

    if (kind === 'daiminkan') {
      ctx.kansBy[q]++;
      if (MF.abortEnabled(RULES.serverAborts, 'suukaikan') && H.isSuukaikanAbort(ctx.kansBy)) {
        console.log(`[bridge] SUUKAIKAN (four kans: ${ctx.kansBy.join('/')}) - abortive draw`);
        return { end: true, winner: -1, winBy: { type: 'abort', reason: 'Suukaikan' } };
      }
      if (ctx.state.powers && typeof ctx.state.powers.broadcastPlayerKan === 'function') {
        ctx.state.powers.broadcastPlayerKan(q, ctx.state);
      }
      // Hook before the dora flip so a seeding power (Saki) can swap the
      // indicator about to be revealed (see doOwnKan). kanCount is the total
      // kan index revealKanDora will use, not the per-seat count.
      if (this.powerOf(q) !== 'none') {
        this.maybeActivateTier(q, ctx.kanCount + 1);
      }
      ctx.revealKanDora();
      const rt = ctx.dead[ctx.rinshanIdx++];
      if (rt !== undefined) {
        qp.hand.push(rt);
        qp.lastDrawn = rt;
        H.clearTempFuritenOnDraw(qp); // a kan draw is still a draw
        const trs = this.scoreFor(q, rt, { tsumo: true, kan: true, last: false, tenhou: false });
        const wantTsumo = this.isAWin(trs) && this.winMeetsFloor(trs);
        const tsumoReason = wantTsumo ? null : this.tsumoBlockReason(q, trs);

        this.room.sendTo(
          q,
          P.event(
            P.evTileDrawn({
              tile: P.sakiToTile(rt),
              remaining: ctx.poolTotal(),
              canTsumo: wantTsumo,
              canTsumoReason: tsumoReason,
              canRiichi: false,
              isFuriten: this.furitenNow(qp),
            })
          )
        );
        for (let s = 0; s < 4; s++) {
          if (s !== q) {
            this.room.sendTo(
              s,
              P.event(
                P.evOtherPlayerDrew({
                  player: P.seatWind(q, ctx.dealer),
                  remaining: ctx.poolTotal(),
                })
              )
            );
          }
        }

        if (wantTsumo && qp.isCpu) {
          this.settlePowerHook({ type: 'tsumo', winner: q, tag: 'RINSHAN' });
          return {
            end: true,
            winner: q,
            winBy: { type: 'tsumo', seat: q, winTile: rt, rinshan: true, haitei: false, first: false },
          };
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
    // Validate the client's chosen pair BEFORE touching the hand. The old code
    // spliced tiles out one by one and then returned null on failure, leaving
    // a partially mutated hand.
    if (!Array.isArray(chosen) || chosen.length !== 2) {
      this.sendError(q, 'InvalidAction', 'chi requires exactly 2 hand tiles');
      return null;
    }
    const legalOpts = H.chiOptions(qp.hand, tile).map(([a, b]) => {
      const s = norm(tile)[1];
      return [`${a}${s}`, `${b}${s}`].map(norm).sort().join(',');
    });
    const normChosen = chosen
      .map((c) => {
        const s = norm(tile)[1];
        // CPU claims carry bare ranks (e.g. 3); human claims carry protocol
        // codes ("3m"). Normalize both to a suit-bearing code before comparing.
        // Previously bare ranks were norm()'d as-is, so CPU chi never matched
        // any legal option and CPU seats could never chi.
        const code = typeof c === 'string' && /[mpsz]$/.test(c) ? c : `${c}${s}`;
        return norm(code);
      })
      .sort()
      .join(',');
    if (!legalOpts.includes(normChosen)) {
      this.sendError(q, 'InvalidAction', 'chosen chi tiles do not match any legal option');
      return null;
    }
    const tiles = [tile];
    const suit = norm(tile)[1];
    // Re-resolve indices without mutating until all are found.
    const indices = [];
    for (const n of chosen) {
      const target =
        typeof n === 'string' && (n.endsWith('m') || n.endsWith('p') || n.endsWith('s') || n.endsWith('z'))
          ? norm(n)
          : n + suit;
      const i = qp.hand.findIndex((x, idx) => !indices.includes(idx) && norm(x) === target);
      if (i < 0) {
        this.sendError(q, 'InvalidAction', 'chosen chi tile not in hand');
        return null;
      }
      indices.push(i);
    }
    // Remove highest indices first so earlier splices don't shift later ones.
    indices.sort((a, b) => b - a).forEach((i) => tiles.push(qp.hand.splice(i, 1)[0]));
    if (tiles.length !== 3) return null; // shouldn't happen (validated)
    ctx.players[from].discards.pop();
    qp.melds.push({ tiles, open: true, type: 'chi' });
    this.broadcast(
      P.evPlayerCalled({
        player: P.seatWind(q, ctx.dealer),
        fromPlayer: P.seatWind(from, ctx.dealer),
        callType: 'Chi',
        calledTile: P.sakiToTile(tile),
        tiles: P.tilesToProtocol(tiles),
      })
    );
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
      melds: p.melds
        .slice()
        .sort(sorter)
        .map((m) => ({
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
        ? [
            {
              seat: winner,
              flags: {
                tsumo: true,
                winTile: winBy.winTile,
                kan: winBy.rinshan,
                last: winBy.haitei,
                tenhou: winBy.first,
              },
            },
          ]
        : winBy.hits.map((h) => ({
            seat: h.seat,
            flags: {
              tsumo: false,
              winTile: winBy.tile,
              kan: !!winBy.flags.chankan,
              last: !!winBy.flags.houtei,
              tenhou: false,
            },
          }));

      // Triple ron (三家和 / sanchahou) is an ABORTIVE draw, not a three-way win:
      // the hand is void, nobody is paid, the dealer repeats and a honba is added.
      // Two claimants is a legal double ron and is paid normally, which is why
      // this is `>= 3` and not `> 1`. See docs/known-issues.md KI-20.
      if (!isTsumo && wins.length >= 3 && MF.abortEnabled(RULES.serverAborts, 'tripleRon')) {
        console.log(
          `[bridge] ABORTIVE triple ron on ${winBy.tile} from P${winBy.from} ` +
            `(seats ${wins.map((w) => 'P' + w.seat).join('/')}) - hand void, no payments`
        );
        return this.abortHand('TripleRon', {});
      }

      // Apply all payments first so every RoundWon shares the same final scores.
      for (const w of wins) {
        const r = this.rescore(w.seat, w.flags);
        w.r = r;
        // Shared score arithmetic (match-flow.js winPayments).
        const { deltas, pay } = MF.winPayments({
          type: isTsumo ? 'tsumo' : 'ron',
          winner: w.seat,
          dealer,
          honba: this.honba,
          result: r,
          from: winBy.from,
        });
        for (let i = 0; i < 4; i++) this.scores[i] += deltas[i];
        w.pay = pay;
      }
      // Riichi sticks to the nearest winner in turn order (wins[0]).
      const sticksGain = ctx.riichiPool;
      this.scores[wins[0].seat] += sticksGain;
      ctx.riichiPool = 0;

      // Emit one RoundWon per winner.
      for (const w of wins) {
        const scorePoints = w.pay + (w === wins[0] ? sticksGain : 0);
        this.broadcast(
          P.evRoundWon({
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
            uradoraIndicators:
              players[w.seat].riichi || players[w.seat].doubleRiichi ? P.tilesToProtocol(ctx.uraInd) : [],
            riichiSticks: sticksGain / 1000,
            honba: this.honba,
            // Total honba embedded in this winner's pay (tsumo sums 3 payers,
            // ron is a single payment). Matches the client's honba*300 fallback.
            honbaPoints: 300 * this.honba,
            playerHands: this.playerHandsInfo(),
          })
        );
        console.log(
          `[bridge] WIN P${w.seat} ${isTsumo ? 'tsumo' : 'ron'} ${w.r.text || ''} han=${w.r.han} fu=${w.r.fu} +${scorePoints}`
        );
        this.settlePowerHook({ type: isTsumo ? 'tsumo' : 'ron', winner: w.seat, tag: winBy.rinshan ? 'RINSHAN' : '' });
      }
    } else {
      // Exhaustive draw. Nagashi mangan replaces the noten exchange: every
      // fully-closed seat whose discards are all terminals/honours wins a
      // mangan tsumo, paid in turn order from the dealer (mirrors game.js).
      const nagashi = [0, 1, 2, 3].filter((s) => H.isNagashi(players[s]));
      if (nagashi.length) {
        const order = [0, 1, 2, 3].map((k) => (dealer + k) % 4).filter((s) => nagashi.includes(s));
        // Shared payout (match-flow.js): a mangan tsumo per qualifying seat.
        const { deltas, totals } = MF.nagashiPayments(order, dealer, this.honba);
        for (let i = 0; i < 4; i++) this.scores[i] += deltas[i];
        const sticksGain = ctx.riichiPool;
        this.scores[order[0]] += sticksGain;
        ctx.riichiPool = 0;
        for (const w of order) {
          const scorePoints = totals[w] + (w === order[0] ? sticksGain : 0);
          this.broadcast(
            P.evRoundWon({
              winner: P.seatWind(w, dealer),
              loser: null,
              winning_tile: null,
              scores: [...this.scores],
              yakuList: [[{ Yaku: 'NagashiMangan' }, 5]],
              han: 5,
              fu: 30,
              scorePoints,
              rank: 'Mangan',
              hasOpened: false,
              uradoraIndicators: [],
              riichiSticks: sticksGain / 1000,
              honba: this.honba,
              honbaPoints: 300 * this.honba,
              playerHands: this.playerHandsInfo(),
            })
          );
          console.log(`[bridge] NAGASHI MANGAN P${w} +${scorePoints}`);
          this.settlePowerHook({ type: 'tsumo', winner: w, tag: 'NAGASHI' });
        }
        return { aborted: false, nagashiSeats: order };
      }
      const tenpai = this.tenpaiSeats();
      const nTen = tenpai.length;
      if (nTen > 0 && nTen < 4) {
        const { give, take } = MF.notenPayments(nTen);
        for (let i = 0; i < 4; i++) this.scores[i] += tenpai.includes(i) ? give : -take;
      }
      // Riichi sticks must not vanish when a hand is drawn, but they are also NOT
      // awarded to the tenpai players. The standard rule is that they stay on the
      // table and are claimed by the next player to win a hand: riichi.wiki's
      // Ryuukyoku page says "any riichi bets left on the table are saved for later
      // rounds", the EMA rules say they "remain on the table until a player wins a
      // hand", and the standard riichi rules sheet says the same under "Handling
      // riichi bets after drawn games".
      //
      // An earlier version of this file split the pot between the tenpai seats at an
      // exhaustive draw. That was wrong, it disagreed with engine/game.js (which has
      // always carried), and it was introduced by this same file's earlier fix for
      // KI-14 — see docs/known-issues.md KI-19. Conservation still holds either way:
      // the pot is on the table in `riichiCarry`, not destroyed.
      const sticks = ctx.riichiPool;
      ctx.riichiPool = 0;
      this.riichiCarry = sticks;

      this.broadcast(
        P.evRoundDraw({
          scores: [...this.scores],
          reason: 'Exhaustive',
          tenpai: tenpai.map((s) => P.seatWind(s, dealer)),
          riichiSticks: sticks / 1000,
          playerHands: this.playerHandsInfo(),
          declarer: null,
        })
      );
      console.log(
        `[bridge] EXHAUSTIVE tenpai=${tenpai.map((s) => 'P' + s).join(',')} sticks=${sticks / 1000} carried=${this.riichiCarry / 1000}`
      );
    }
    // Every path returns a descriptor, so playOneHand can branch on `aborted`
    // without having to distinguish "returned nothing" from "returned a falsy value".
    return { aborted: false };
  }
}

module.exports = { Table, PHASE, START_SCORE, TOTAL_ROUNDS };

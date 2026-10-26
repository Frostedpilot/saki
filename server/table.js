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
const HD = require('../engine/hand-driver');

// A character hook that throws must not break the match, but it must not be
// silent either. The diagnostics policy and the power subsystem live next to
// the Table in `hook-utils.js` / `table-powers.js` (KI-11).
const { warnOnce } = require('./hook-utils');
const Powers = require('./table-powers');
const Journal = require('./journal');
const replay = require('../engine/replay');

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

const { PHASE } = require('./phases');
const Calls = require('./table-calls');

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
    // Opt-in audit trail (SAKI_JOURNAL_DIR). Allocated on the first hand.
    this.journalDir = Journal.journalDir();
    this.journal = null;
    this.journalFile = null;
  }

  recordJournal(seat, type, payload) {
    if (this.journal) replay.record(this.journal, seat, type, payload);
  }

  // Write the match's journal once. Safe to call at any point; repeated calls
  // return the same path instead of rewriting.
  flushJournal() {
    if (!this.journal || !this.journalDir || this.journalFile) return this.journalFile;
    this.journalFile = Journal.writeJournal(this.journalDir, this.journal);
    return this.journalFile;
  }

  setArmedTier(seat, tier) {
    Powers.setArmedTier(this, seat, tier);
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
    Powers.broadcastPowerStatus(this);
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
    const journal = this.flushJournal();
    if (journal) console.log(`[bridge] ${code}: journal written to ${journal}`);
    this.room.afterGameOver();
  }

  async playOneHand() {
    const kyoku = this.kyoku;
    const dealer = this.dealer;
    const bakazeNum = H.bakazeOf(kyoku);

    const seed = (this.seed + kyoku * 7919 + this.honba * 104729 + dealer * 131071) >>> 0;
    if (this.journalDir && !this.journal) this.journal = replay.createJournal(this.seed);
    if (this.journal) replay.startKyoku(this.journal, seed);
    const state = core.createMatchState({ seed });
    state.onDeadWallSwap = (slot, tile) => this.recordJournal(null, 'swap', { slot, tile });
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
    // Hand-level turn order is shared with the CLI (engine/hand-driver.js).
    // The adapter still owns this table's per-turn work and settlement.
    outcome = await HD.playHand({
      checkKyuushu: () => this.checkKyuushu(),
      abortKyuushu: (seat) => this.abortHand('KyuushuKyuuhai', { declarer: seat }),
      dealer: () => dealer,
      wallLeft: () => ctx.poolTotal(),
      playTurn: (turn) => this.playTurn(turn),
      settle: (w, wb) => {
        winner = w;
        winBy = wb;
        if (wb && wb.type === 'abort') return this.abortHand(wb.reason, {});
        if (wb && wb.type === 'chombo') return this.chomboHand(wb.offender);
        return this.finishHand(w, wb);
      },
      onSafetyStop: () => console.error('[bridge] turn safety stop'),
    });

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
    return TC.beginTurn(me, {
      callsMade: c.callsMade,
      drawsThisKyoku: c.drawsThisKyoku,
      wallLeft: c.poolTotal(),
    }).firstDraw;
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
    return HD.playTurn(this, seat);
  }

  wallLeft() {
    return this.ctx.poolTotal();
  }

  // --- adapter surface for engine/hand-driver.js -------------------------

  startTurn(seat) {
    this.phase = PHASE.TURN_ACT;
    this.activeSeat = seat;
    return Date.now();
  }

  onTurnStart(seat) {
    this.maybeActivateTurnPower(seat);
  }

  async drawTurn(seat) {
    const drawn = core.executeDrawStep(seat, this.ctx.state);
    if (drawn !== null) this.recordJournal(seat, 'draw', drawn);
    return drawn;
  }

  onWallExhausted() {
    return { end: true, winner: -1, winBy: null };
  }

  onInvalidTsumo(seat) {
    return { end: true, winner: seat, winBy: null }; // should not happen
  }

  onDiscardError(seat, reason) {
    this.sendError(seat, 'InvalidAction', reason);
    return { end: true, winner: -1, winBy: null };
  }

  onTsumo(seat, { turnStart }) {
    return {
      end: true,
      winner: seat,
      winBy: {
        type: 'tsumo',
        seat,
        winTile: this.ctx.players[seat].lastDrawn,
        rinshan: false,
        haitei: turnStart.isLastDraw,
        first: turnStart.firstDraw,
      },
    };
  }

  emitDraw(seat, drawn, { tsumoScore, wantTsumo, tsumoReason }) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
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
  }

  async chooseTurnAction(seat, { turnStart, turnStartTime, wantTsumo, kan }) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
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
        const v = this.validateAct(seat, a, {
          wantTsumo,
          firstDraw: turnStart.firstDraw,
          isLastDraw: turnStart.isLastDraw,
        });
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
        isLastDraw: turnStart.isLastDraw,
      });
      if (action.type === 'Kan') action.kan = kanChoice;
      await botWait(turnStartTime);
    }
    return action;
  }

  async afterDiscard(seat, { action }) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
    // Snapshot waits after the discard for EVERY seat (human and CPU):
    // classifyHumanKan -> ankanKeepsWaits reads riichiWaits, and spreading
    // undefined would throw and kill the match. Never leave it unset.
    if (action.type === 'Riichi') {
      me.riichiWaits = H.getWaits(me, ctx.players, ctx.dead, {
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
  }

  declareRiichi(seat, riichiFirst) {
    const ctx = this.ctx;
    const me = ctx.players[seat];
    me.riichi = true;
    me.doubleRiichi = !!riichiFirst;
    me.ippatsu = true;
    // The declaring discard itself must not clear ippatsu; the next discard
    // does (shared resolveDiscard). Any call in between clears both.
    me.ippatsuJustDeclared = true;
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
    this.recordJournal(seat, 'discard', removed);
    this.assertConserved(`after seat ${seat} discarded ${removed}`);
    // Suufon-renda accumulator and ippatsu expiry: shared bookkeeping.
    const discard = TC.resolveDiscard({
      callsMade: ctx.callsMade,
      suufonDone: ctx.suufonDone,
      discardsCount: me.discards.length,
      ippatsu: me.ippatsu,
      ippatsuJustDeclared: me.ippatsuJustDeclared,
    });
    me.ippatsu = discard.ippatsu;
    me.ippatsuJustDeclared = discard.ippatsuJustDeclared;
    if (discard.firstLap) ctx.firstLapDiscards.push(removed);
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
      this.recordJournal(seat, 'call', { kind: 'kakan', tiles: [...pm.tiles] });
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
      this.recordJournal(seat, 'call', { kind: 'ankan', tiles: [...tiles] });
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
    this.recordJournal(seat, 'rinshan', rt);
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
    Powers.maybeActivateTurnPower(this, seat);
  }

  maybeActivateTier(seat, kanCount) {
    Powers.maybeActivateTier(this, seat, kanCount);
  }

  settlePowerHook(result) {
    Powers.settlePowerHook(this, result);
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
    return Calls.collectRon(this, tile, from, flags);
  }

  // Unified, simultaneous call window for Ron, Pon/Kan, and Chi with priority arbitration.
  async resolveCallWindow(from, tile, flags = {}) {
    return Calls.resolveCallWindow(this, from, tile, flags);
  }

  removeCopies(hand, tile, n) {
    return Calls.removeCopies(hand, tile, n);
  }

  async doOpenCall(q, from, tile, kind) {
    return Calls.doOpenCall(this, q, from, tile, kind);
  }

  async doOpenChi(q, from, tile, chosen) {
    return Calls.doOpenChi(this, q, from, tile, chosen);
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

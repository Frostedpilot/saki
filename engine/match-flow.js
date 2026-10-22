// match-flow.js — shared hand-transition decisions for both rule front-ends.
//
// KI-04: `engine/game.js main()` (offline CLI while-loop) and
// `server/table.js Table` (networked async phase machine) drove the same
// hand lifecycle — dealer repeat, honba, kyoku advance, tenpai payments,
// bust-out — with independent inline copies. The turn loops themselves cannot
// merge (sync CLI vs async WebSocket), but the *transition table* is pure and
// shared here:
//
//   abort (incl. chombo replay) -> dealer repeats, honba+1
//   win, dealer won              -> dealer repeats, honba+1
//   win, non-dealer won          -> rotate, honba=0
//   exhaustive, dealer tenpai    -> dealer repeats, honba+1
//   exhaustive, dealer noten     -> rotate, honba+1
//
// Server gaps stay explicit, not silent: agari-yame/enchousen exist only in
// game.js (the five abortive draws, nagashi mangan and chombo-as-penalty are
// now implemented on both sides). This module also owns the pieces both loops
// ran inline — the point *arithmetic* (the win settlement `winPayments`, the
// mangan payments `manganPayment`/`nagashiPayments`), the abortive-draw switch
// (`abortEnabled`, read with `RULES.aborts` / `RULES.serverAborts`), and the
// dead-wall indicator layout (`doraIndicatorSlots`) — so a rule changed here
// cannot land in one front-end only. The game.js-only paths keep their inline
// code and are marked as such at the call site.
'use strict';

const { RULES } = require('./rules-config');

// True when the dealer is among the winners. Accepts both front-end shapes:
// game.js ron uses wins[].seat, table.js ron uses hits[].seat; tsumo passes
// the single winner seat in both.
function dealerWonOnWin(winType, winnerSeats, dealer) {
  if (!Array.isArray(winnerSeats) || winnerSeats.length === 0) return false;
  void winType;
  return winnerSeats.includes(dealer);
}

// The hand -> next-hand transition, shared by both drivers. This is the
// deterministic half of the orchestration: given what happened, it says how the
// next hand's counters move. Match-END policy (tobi, agari-yame, enchousen) stays
// at the driver, because the CLI prompts a human and the server decides silently.
//
//   kind: 'win' | 'abort' | 'chombo' | 'exhaustive'
//   winnerSeats: winners (kind 'win')
//   tenpaiSeats: seats in tenpai (kind 'exhaustive')
//   nagashiSeats: seats with nagashi mangan (kind 'exhaustive')
//
// Returns { honba: 'increment' | 'reset' | 'keep', keepDealer, kyokuRepeat }.
// Callers apply honba/kyoku themselves so each front-end keeps owning its counters.
//
// Exhaustive: a nagashi mangan is a win, so the dealer repeats only when the
// dealer is among the nagashi seats (a tenpai dealer does NOT also repeat when
// someone else nagashi'd). Without nagashi, the dealer repeats iff tenpai.
function handOutcome({ kind, winnerSeats = [], tenpaiSeats = [], nagashiSeats = [], dealer }) {
  switch (kind) {
    case 'chombo':
      // Penalty, honba unchanged, replay the same kyoku.
      return { honba: 'keep', keepDealer: true, kyokuRepeat: true };
    case 'abort':
      return { honba: 'increment', keepDealer: true, kyokuRepeat: true };
    case 'win':
      return dealerWonOnWin('', winnerSeats, dealer)
        ? { honba: 'increment', keepDealer: true, kyokuRepeat: true }
        : { honba: 'reset', keepDealer: false, kyokuRepeat: false };
    case 'exhaustive': {
      const keySeats = nagashiSeats.length ? nagashiSeats : tenpaiSeats;
      const keep = keySeats.includes(dealer);
      return { honba: 'increment', keepDealer: keep, kyokuRepeat: keep };
    }
    default:
      throw new Error(`handOutcome: unknown kind ${kind}`);
  }
}

// The shared transition. Inputs are already-normalized seats:
//   outcome: { aborted: boolean } | null
//   win: null (exhaustive draw) or { winnerSeats: number[] }
//   tenpaiSeats: number[] (only consulted on exhaustive draws)
// Returns { keepDealer, honba: 'increment' | 'reset', kyokuRepeat: boolean }.
// Callers apply honba++/honba=0 and kyoku-- themselves so each front-end keeps
// owning its own counters (no hidden mutation across the CLI/server boundary).
function postHandFlow({ aborted, chombo, win, tenpaiSeats, nagashiSeats, dealer }) {
  if (chombo) return handOutcome({ kind: 'chombo', dealer });
  if (aborted) return handOutcome({ kind: 'abort', dealer });
  if (win) return handOutcome({ kind: 'win', winnerSeats: win.winnerSeats, dealer });
  return handOutcome({ kind: 'exhaustive', tenpaiSeats, nagashiSeats, dealer });
}

// Standard noten exchange for nTenpai tenpai seats (1..3). Returns per-seat
// { give, take }: tenpai seats gain `give`, noten seats lose `take`.
// 0/4 tenpai moves nothing. Reads RULES.notenTotal (3000): 1:+3000/-1000,
// 2:+1500/-1500, 3:+1000/-3000.
function notenPayments(nTen) {
  const total = RULES.notenTotal;
  const table = {
    1: { give: total, take: total / 3 },
    2: { give: total / 2, take: total / 2 },
    3: { give: total / 3, take: total },
  };
  return table[nTen] || { give: 0, take: 0 };
}

// Minimum han for a win: 2 during enchousen overtime (ryanhan-shibari), else 1.
// Reads RULES rather than inline literals.
function minHan(overtime) {
  return overtime ? RULES.overtimeMinHan : RULES.minHan;
}

// Abortive-draw switch. Each front-end passes its own enabled-flag set —
// `RULES.aborts` for the offline engine, `RULES.serverAborts` for the server —
// and a *detected* abort is only declared when its flag is not explicitly
// `false`. Defaulting to enabled means a missing (or misspelled) key can never
// silently disable a rule; only a deliberate `false` does. Both sets enable all
// five today, so this is behaviour-neutral — it is the switch `conventions.md`
// and `rules-config.js` promise, made live.
function abortEnabled(flags, name) {
  return !flags || flags[name] !== false;
}

// Dead-wall indicator layout, shared so the stride lives in one place. The wall
// is RULES.deadWallLength (14) tiles: the first RULES.rinshanSlots (4) are the
// rinshan draws, then dora/ura indicator pairs. `kans` 0 is the initial pair; the
// `kans`-th kan reveals the next pair. `revealed` is false once that pair would
// run past the wall (so a fifth kan adds no indicator). Both front-ends index
// `dead` through this.
function doraIndicatorSlots(kans) {
  const dora = RULES.rinshanSlots + kans * 2;
  const ura = dora + 1;
  return { dora, ura, revealed: ura < RULES.deadWallLength };
}

// One mangan-tsumo payment from `payer` to `collector`: 4000 when either side
// is the dealer (the dealer always pays/receives the dealer rate), 2000
// otherwise, plus RULES.honbaTsumo per honba. This single rule was written out
// three times — twice as the inline nagashi payout (game.js and table.js) and
// once as game.js's chombo penalty — with the chombo copy passing honba 0
// (a penalty ignores honba). Both callers now share it.
function manganPayment(payer, collector, dealer, honba = 0) {
  const base = payer === dealer || collector === dealer ? 4000 : 2000;
  return base + RULES.honbaTsumo * honba;
}

// Nagashi mangan: each qualifying seat, processed in `order` (turn order from
// the dealer), is treated as a mangan tsumo. The amounts depend only on the
// dealer and honba, not on the running scores, so this is pure: callers add
// `deltas` to their own score array. Returns per-seat deltas and each winner's
// collected total. The riichi-stick award (to the first winner in turn order)
// is the caller's, not this module's.
function nagashiPayments(order, dealer, honba) {
  const deltas = [0, 0, 0, 0];
  const totals = [0, 0, 0, 0];
  for (const w of order) {
    let total = 0;
    for (let i = 0; i < 4; i++) {
      if (i === w) continue;
      const pay = manganPayment(i, w, dealer, honba);
      deltas[i] -= pay;
      total += pay;
    }
    deltas[w] += total;
    totals[w] = total;
  }
  return { deltas, totals };
}

// Score distribution for a single winning seat — the arithmetic both front-ends
// ran inline. `result` is the scorer output (`oya`/`ko` for a tsumo, `ten` for a
// ron). Returns per-seat `deltas` and `pay`, the total the winner collects from
// the other seats *before* the riichi-stick award, which the caller gives to the
// nearest winner in turn order. Pure: callers add `deltas` to their scores.
//
// Dealer-ness drives the tsumo split: a dealer winner takes the dealer rate from
// every seat; a non-dealer winner takes the dealer rate from the dealer and the
// child rate from the other children. `from` is the discarder on a ron.
function winPayments({ type, winner, dealer, honba, result, from }) {
  const deltas = [0, 0, 0, 0];
  let pay = 0;
  if (type === 'tsumo') {
    for (let i = 0; i < 4; i++) {
      if (i === winner) continue;
      const base = winner === dealer ? result.oya[0] : i === dealer ? result.ko[0] : result.ko[1];
      const p = base + RULES.honbaTsumo * honba;
      deltas[i] -= p;
      pay += p;
    }
    deltas[winner] += pay;
  } else {
    pay = result.ten + RULES.honbaRon * honba;
    deltas[from] -= pay;
    deltas[winner] += pay;
  }
  return { deltas, pay };
}

// Tobi bust-out: index of the first sub-zero score, or -1.
function bustOutSeat(scores) {
  return scores.findIndex((s) => s < 0);
}

// Agari-yame gate: the dealer ends the match only when strictly leading
// (sole top score). Ties play on.
function dealerLeads(scores, dealer) {
  const d = scores[dealer];
  return scores.every((s, i) => i === dealer || d > s);
}

module.exports = {
  dealerWonOnWin,
  handOutcome,
  postHandFlow,
  notenPayments,
  minHan,
  abortEnabled,
  doraIndicatorSlots,
  manganPayment,
  nagashiPayments,
  winPayments,
  bustOutSeat,
  dealerLeads,
};

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
// Server gaps stay explicit, not silent: agari-yame/enchousen and
// chombo-as-penalty exist only in game.js (the five abortive draws and nagashi
// mangan are now implemented on both sides). This module also owns the point
// *arithmetic* both loops ran inline — the win settlement (`winPayments`) and
// the mangan payments (`manganPayment`/`nagashiPayments`) — so a scoring rule
// changed here cannot land in one front-end only. The game.js-only paths keep
// their inline code and are marked as such at the call site.
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

// The shared transition. Inputs are already-normalized seats:
//   outcome: { aborted: boolean } | null
//   win: null (exhaustive draw) or { winnerSeats: number[] }
//   tenpaiSeats: number[] (only consulted on exhaustive draws)
// Returns { keepDealer, honba: 'increment' | 'reset', kyokuRepeat: boolean }.
// Callers apply honba++/honba=0 and kyoku-- themselves so each front-end keeps
// owning its own counters (no hidden mutation across the CLI/server boundary).
function postHandFlow({ aborted, win, tenpaiSeats, dealer }) {
  if (aborted) {
    // Abortive draw (incl. triple ron): void hand, same dealer redeals.
    return { keepDealer: true, honba: 'increment', kyokuRepeat: true };
  }
  if (win) {
    if (dealerWonOnWin(win.type, win.winnerSeats, dealer)) {
      return { keepDealer: true, honba: 'increment', kyokuRepeat: true };
    }
    return { keepDealer: false, honba: 'reset', kyokuRepeat: false };
  }
  // Exhaustive draw: honba always grows; dealer repeats iff tenpai.
  const keepDealer = Array.isArray(tenpaiSeats) && tenpaiSeats.includes(dealer);
  return { keepDealer, honba: 'increment', kyokuRepeat: keepDealer };
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
  postHandFlow,
  notenPayments,
  minHan,
  manganPayment,
  nagashiPayments,
  winPayments,
  bustOutSeat,
  dealerLeads,
};

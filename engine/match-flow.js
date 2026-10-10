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
// Server gaps stay explicit, not silent: kyuushu/suufon/suucha/suukaikan,
// nagashi, agari-yame/enchousen and chombo-as-penalty exist only in game.js.
// This module covers the paths both front-ends implement; the game.js-only
// paths keep their inline code and are marked as such at the call site.
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

// Tobi bust-out: index of the first sub-zero score, or -1.
function bustOutSeat(scores) {
  return scores.findIndex((s) => s < 0);
}

module.exports = { dealerWonOnWin, postHandFlow, notenPayments, minHan, bustOutSeat };

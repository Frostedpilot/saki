'use strict';
// hand-driver.js — the hand-level turn order shared by both front-ends.
//
// This is phase 4a of the turn-loop merge (see docs/turn-loop-merge.md). It
// owns only the outer loop: kyuushu, "whose turn is it", the safety stop, and
// the transition into settlement. The per-turn work is still supplied by the
// adapter, because the CLI and the server are mid-migration: `game.js` has its
// turn inline in `main()` and `table.js` has `playTurn()`.
//
// The contract is deliberately small so it can survive that migration:
//
//   checkKyuushu()        -> seat (>= 0) or -1
//   abortKyuushu(seat)    -> settlement result
//   dealer()              -> seat
//   wallLeft()            -> live-wall count (> 0 means keep playing)
//   playTurn(seat)        -> { end, winner?, winBy?, next? }
//   settle(winner, winBy) -> settlement result
//   onSafetyStop()        -> optional; called before settling an overlong hand
//
// Later phase-4 steps move draw/tsumo/kan/riichi/discard/call-window decisions
// into this module; the adapter then shrinks to I/O, powers and settlement.
async function playHand(adapter, { maxTurns = 400 } = {}) {
  const kyuushuSeat = await adapter.checkKyuushu();
  if (Number.isInteger(kyuushuSeat) && kyuushuSeat >= 0) {
    return adapter.abortKyuushu(kyuushuSeat);
  }

  let winner = -1;
  let winBy = null;
  let turn = adapter.dealer();
  let guard = 0;

  while (adapter.wallLeft() > 0) {
    if (++guard > maxTurns) {
      if (typeof adapter.onSafetyStop === 'function') adapter.onSafetyStop(guard);
      break;
    }
    const out = await adapter.playTurn(turn);
    if (out && out.end) {
      winner = out.winner;
      winBy = out.winBy;
      break;
    }
    turn = out && out.next !== undefined ? out.next : (turn + 1) % 4;
  }

  return adapter.settle(winner, winBy);
}

module.exports = { playHand };

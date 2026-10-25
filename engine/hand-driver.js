'use strict';
// hand-driver.js — the hand-level turn order shared by both front-ends.
//
// This is phase 4 of the turn-loop merge (see docs/turn-loop-merge.md). It
// owns the outer loop (kyuushu, "whose turn is it", the safety stop) and the
// per-turn skeleton (draw → tsumo/kan/riichi/discard → call window). The
// adapter owns every await, every message, the draw model, powers and the
// settlement shape.
//
// The contract is deliberately small so it can survive the migration:
//
//   checkKyuushu()        -> seat (>= 0) or -1
//   abortKyuushu(seat)    -> settlement result
//   dealer()              -> seat
//   wallLeft()            -> live-wall count (> 0 means keep playing)
//   playTurn(seat)        -> { end, winner?, winBy?, next? }
//   settle(winner, winBy) -> settlement result
//   onSafetyStop()        -> optional; called before settling an overlong hand
//
// Per-turn adapter:
//   ctx, startTurn(seat), onTurnStart(seat), drawTurn(seat), wallLeft()
//   scoreFor/isAWin/winMeetsFloor/tsumoBlockReason
//   emitDraw(seat, tile, info), chooseTurnAction(seat, info)
//   onTsumo/onInvalidTsumo/onWallExhausted/onDiscardError
//   doOwnKan/declareRiichi/executeDiscard/afterDiscard/resolveCallWindow
//
// `playHand` is the outer loop; `playTurn` is the per-turn skeleton. Both are
// async so the CLI's readline and the server's WebSocket request share them.
const TC = require('./turn-core');
const { clearTempFuritenOnDraw } = require('./helpers');

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

async function playTurn(adapter, seat) {
  const ctx = adapter.ctx;
  const me = ctx.players[seat];
  const turnStartTime = adapter.startTurn(seat);

  ctx.drawsThisKyoku++;
  clearTempFuritenOnDraw(me);
  const turnStart = TC.beginTurn(me, {
    callsMade: ctx.callsMade,
    drawsThisKyoku: ctx.drawsThisKyoku,
    wallLeft: adapter.wallLeft(),
  });
  adapter.onTurnStart(seat, turnStart);

  const drawn = await adapter.drawTurn(seat);
  if (drawn === null) return adapter.onWallExhausted(seat);
  me.lastDrawn = drawn;

  const tsumoScore = adapter.scoreFor(seat, drawn, turnStart.tsumoFlags);
  const wantTsumo = adapter.isAWin(tsumoScore) && adapter.winMeetsFloor(tsumoScore);
  const tsumoReason = wantTsumo ? null : adapter.tsumoBlockReason(seat, tsumoScore);
  adapter.emitDraw(seat, drawn, { turnStart, tsumoScore, wantTsumo, tsumoReason });

  const kan = TC.kanOptions(me, { kanCount: ctx.kanCount, rinshanIdx: ctx.rinshanIdx });
  const action = await adapter.chooseTurnAction(seat, {
    turnStart,
    turnStartTime,
    drawn,
    tsumoScore,
    wantTsumo,
    tsumoReason,
    kan,
  });

  if (action.type === 'Tsumo') {
    if (wantTsumo) return adapter.onTsumo(seat, { turnStart });
    return adapter.onInvalidTsumo(seat);
  }
  if (action.type === 'Kan') return adapter.doOwnKan(seat, me, action.kan);

  if (action.type === 'Riichi') adapter.declareRiichi(seat, action.riichiFirst);
  const disc = await adapter.executeDiscard(seat, action.tile, { banned: [] });
  if (disc && disc.error) return adapter.onDiscardError(seat, disc.error);

  await adapter.afterDiscard(seat, { turnStart, disc, action });
  const callOut = await adapter.resolveCallWindow(seat, disc.tile, { houtei: adapter.wallLeft() === 0 });
  if (callOut) return callOut;
  return { end: false, next: (seat + 1) % 4 };
}

module.exports = { playHand, playTurn };

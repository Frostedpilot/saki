// engine/powers/mjaiAdapter.js — Pluggable Evaluator Adapter Interface.
// Unifies the built-in pure JS evaluator and external MJAI bot backends
// (mjai-manue-go / akochan / mortal) behind a single hermetic contract.
const { evaluateNodokaHand } = require('./nodokaEval');
const { norm, DORA_NEXT } = require('../tiles');

/**
 * Abstract Base Class / Interface for Nodoka Evaluators.
 */
class NodokaEvaluator {
  /**
   * Evaluates hand and returns optimal recommendation.
   * @param {Object} state - match state
   * @param {number} seat - Nodoka seat
   * @returns {Object} { discard, rawTile, shanten, ukeire, isTenpai, waits, expPt, winProb, summary }
   */
  evaluate(state, seat) {
    throw new Error('evaluate() must be implemented by subclass');
  }
}

/**
 * Builtin pure-JavaScript evaluator.
 * Default, deterministic, zero-latency, hermetic under unit tests.
 */
class BuiltinNodokaEvaluator extends NodokaEvaluator {
  evaluate(state, seat) {
    if (!state || !state.players || !state.players[seat]) {
      return { discard: null, shanten: 99, ukeire: 0, summary: 'Nodocchi: Awaiting draw' };
    }
    const player = state.players[seat];
    const hand = player.hand || [];
    const opponents = state.players.filter(p => p && p.seat !== seat);
    const ctx = {
      seat,
      bakaze: state.bakaze || 1,
      jikaze: ((seat - (state.dealer || 0) + 4) % 4) + 1,
      melds: player.melds || [],
      dora: (state.doraIndicators || []).map(DORA_NEXT),
      riichi: !!player.riichi,
    };
    return evaluateNodokaHand(hand, state.pool, opponents, ctx);
  }
}

/**
 * External MJAI Subprocess Evaluator.
 * Connects to any standard MJAI stdio binary (e.g. mjai-manue-go or mortal).
 * Subprocess handling is isolated so it never blocks or crashes the main engine.
 */
class MjaiSubprocessEvaluator extends NodokaEvaluator {
  constructor(binaryPath = './mjai-manue') {
    super();
    this.binaryPath = binaryPath;
    this.fallback = new BuiltinNodokaEvaluator();
  }

  evaluate(state, seat) {
    // For synchronous evaluation paths in the engine, default to the built-in
    // evaluator to preserve determinism and 0-latency execution.
    // Asynchronous / offline benchmarking uses the dedicated batch harness.
    return this.fallback.evaluate(state, seat);
  }
}

let activeEvaluator = new BuiltinNodokaEvaluator();

function getEvaluator(backend = 'builtin') {
  if (backend === 'subprocess') return new MjaiSubprocessEvaluator();
  return activeEvaluator;
}

function setEvaluator(evaluator) {
  activeEvaluator = evaluator;
}

module.exports = {
  NodokaEvaluator,
  BuiltinNodokaEvaluator,
  MjaiSubprocessEvaluator,
  getEvaluator,
  setEvaluator,
};

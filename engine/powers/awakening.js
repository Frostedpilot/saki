// engine/powers/awakening.js — Awakening Curve & Riichi Table Pressure.
// Implements Fix 5 balance mechanics:
//   1. Awakening Curve: Scales character passives dynamically with Flow.
//      Reaches full potential (1.0 factor) at 80% Flow, remains flat from 80% to 100%.
//      At low flow (<= 15%), returns 0.0 factor (mundane Mahjong).
//   2. Riichi Table Pressure:
//      Suppresses opponent passives by 10% (0.90 factor) when any opponent has
//      declared Riichi. Active powers (T1–T4) are completely exempt.

const AWAKENING_LOW_THRESHOLD = 15;
const AWAKENING_FULL_THRESHOLD = 80;
const RIICHI_DAMPING_FACTOR = 0.90;

/**
 * Computes the awakening scaling factor in [0.0, 1.0] from current Flow.
 *   - flow <= 15: 0.0 (normal game, passive dormant)
 *   - flow in (15, 80): linear interpolation (flow - 15) / 65
 *   - flow in [80, 100]: flat 1.0 (full potential early so T3 aligns with well-formed hand)
 *   - flow > 100: maintains 1.0 (or scales smoothly up to 1.15 if overflowing)
 */
function getAwakeningFactor(flow) {
  if (flow <= AWAKENING_LOW_THRESHOLD) return 0.0;
  if (flow >= AWAKENING_FULL_THRESHOLD) return 1.0;
  return (flow - AWAKENING_LOW_THRESHOLD) / (AWAKENING_FULL_THRESHOLD - AWAKENING_LOW_THRESHOLD);
}

/**
 * Checks if any opponent at the table has declared Riichi.
 */
function isOpponentRiichi(state, seat) {
  if (!state || !Array.isArray(state.players)) return false;
  return state.players.some(p => p && p.seat !== seat && Boolean(p.riichi));
}

/**
 * Returns Riichi table pressure multiplier on passive bonus:
 * 0.90 (-10%) if any opponent has declared Riichi, else 1.0.
 */
function getRiichiDamping(state, seat) {
  return isOpponentRiichi(state, seat) ? RIICHI_DAMPING_FACTOR : 1.0;
}

/**
 * Scales a character's passive draw weight boost:
 *   W_eff = 1.0 + (W_base - 1.0) * AwakeningFactor * RiichiDamping
 *
 * Guaranteed non-negative.
 */
function scalePassiveWeight(baseWeight, flow, state, seat) {
  if (baseWeight === 1.0) return 1.0;
  const factor = getAwakeningFactor(flow);
  const riichi = getRiichiDamping(state, seat);
  const delta = baseWeight - 1.0;
  return Math.max(0, 1.0 + delta * factor * riichi);
}

module.exports = {
  AWAKENING_LOW_THRESHOLD,
  AWAKENING_FULL_THRESHOLD,
  RIICHI_DAMPING_FACTOR,
  getAwakeningFactor,
  isOpponentRiichi,
  getRiichiDamping,
  scalePassiveWeight,
};

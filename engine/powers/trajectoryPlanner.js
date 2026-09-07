// trajectoryPlanner.js — Hand Trajectory DAG (Spec §4).
// Models hands as paths toward target archetypes; computes bridge tiles
// (tiles that decrease shanten) and expected value from pool availability.
const syanten = require('syanten');
const { toCounts, norm, KINDS } = require('../tiles');

function shantenOf(hand) {
  try { return syanten(toCounts(hand)); } catch { return 99; }
}
function hairiOf(hand) {
  try { return syanten.hairi(toCounts(hand)); } catch { return {}; }
}

// Uke-ire: number of remaining copies that improve shanten (hairi tiles).
function ukeire(hand, pool) {
  const h = hairiOf(hand);
  if (!h || !h.wait) return 0;
  let n = 0;
  for (const [tile, count] of Object.entries(h.wait)) {
    void count;
    const live = pool ? (pool.get(tile) || 0) + (pool.get(tile.replace('5', '0')) || 0) : 4;
    n += live;
  }
  return n;
}

// Marginal uke-ire gain of drawing tile t (for Nodoka-style EV weighting).
function calculateUkeireGain(hand, tile) {
  const before = ukeire(hand, null);
  const after = ukeire([...hand, tile].slice(-14), null);
  return Math.max(0, after - before);
}

// Optimal bridge tiles: tiles from pool that reduce shanten distance.
function getOptimalBridges(hand, pool, topN = 2) {
  const h = hairiOf(hand);
  if (!h || !h.wait) return [];
  const waits = Object.keys(h.wait).map(norm);
  // filter to tiles still live in pool (conservation-aware)
  const live = waits.filter(w => {
    if (!pool) return true;
    return (pool.get(w) || 0) > 0 || (pool.get(w.replace(/^5/, '0')) || 0) > 0;
  });
  // rank by remaining count (EV proxy)
  live.sort((a, b) => {
    const ca = pool ? (pool.get(a) || 0) : 4;
    const cb = pool ? (pool.get(b) || 0) : 4;
    return cb - ca;
  });
  return live.slice(0, topN);
}

function getActiveTrajectory(hand, pool) {
  const d = shantenOf(hand);
  const bridges = getOptimalBridges(hand, pool, 4);
  let live = 0;
  if (pool) for (const b of bridges) live += pool.get(b) || 0;
  return { archetype: 'general', shanten: d, bridges, evProxy: live };
}

// Intent inference on discard: which archetype did the player prioritize?
// Minimal engine version: delta-shanten per trajectory (only general supported;
// character rosters extend with archetype-specific evaluators).
function inferIntent(handBefore, handAfter) {
  return { dBefore: shantenOf(handBefore), dAfter: shantenOf(handAfter) };
}

module.exports = { shantenOf, hairiOf, ukeire, calculateUkeireGain, getOptimalBridges, getActiveTrajectory, inferIntent };

// core.js — 4-phase lifecycle glue (Spec §3, §7).
// Canonical draw step:
//
//   const trajectory = TrajectoryPlanner.getActiveTrajectory(hand, pool);
//   const weights = PowerDispatcher.computeDrawWeights(seat, state, trajectory);
//   const drawn = DynamicPool.sample(pool, weights, rng);
//
const { DynamicPool } = require('./powers/dynamicPool');
const TrajectoryPlanner = require('./powers/trajectoryPlanner');
const { FlowManager } = require('./powers/flowManager');
const { dispatcher } = require('./powers/index');
const { createRNG } = require('./rng');

function createMatchState({ seed = 1, nSeats = 4 } = {}) {
  const rng = createRNG(seed);
  const pool = DynamicPool.full(rng);
  const flow = new FlowManager(nSeats);
  return {
    rng,
    pool,
    flow,
    powers: dispatcher,
    players: Array.from({ length: nSeats }, (_, i) => ({ seat: i, hand: [], melds: [], discards: [] })),
    deadWall: [], // 14 wanpai tiles (Phase 1)
    turn: 0,
  };
}

// Phase 1: allocate 14-tile wanpai from the live pool (uniform sample).
function setupDeadWall(state) {
  state.deadWall = [];
  for (let i = 0; i < 14; i++) {
    const t = state.pool.sample();
    if (t === null) throw new Error('core.setupDeadWall: pool exhausted');
    state.deadWall.push(t);
  }
  return state.deadWall;
}

// Phase 0+1 combined helper: deal 13 tiles per seat from the pool.
function dealHands(state) {
  for (let k = 0; k < 13; k++) {
    for (const p of state.players) {
      const t = state.pool.sample();
      if (t === null) throw new Error('core.dealHands: pool exhausted');
      p.hand.push(t);
    }
  }
}

// Phase 2: canonical draw step (Spec §7). Returns drawn tile or null.
function executeDrawStep(seat, state) {
  const player = state.players[seat];
  const trajectory = TrajectoryPlanner.getActiveTrajectory(player.hand, state.pool);
  const weights = state.powers.computeDrawWeights(seat, state, trajectory);
  const drawnTile = state.pool.sample(weights);
  if (drawnTile === null) return null;
  player.hand.push(drawnTile);
  state.powers.onPostDraw(seat, drawnTile, state);
  return drawnTile;
}

// Phase 2b: rinshan-slot exchange (Slot Reserver primitive, Spec §5.2).
// Swaps a specific tile from the live pool into deadWall[slotIdx], returning
// the displaced tile to the pool. Wanpai stays exactly 14 tiles.
// Returns true on success, false if the tile is unavailable (caller falls back).
function exchangeDeadWallSlot(state, slotIdx, tile) {
  if (slotIdx < 0 || slotIdx >= state.deadWall.length) return false;
  if (!state.pool.get(tile)) return false;
  state.pool.decrement(tile);
  const old = state.deadWall[slotIdx];
  state.deadWall[slotIdx] = tile;
  state.pool.counts[old] = (state.pool.counts[old] || 0) + 1;
  return true;
}

// Weighted rinshan placement: samples the replacement tile from the live pool
// under weightOf and swaps it into deadWall[slotIdx]. This is how rinshan
// "weights" (T1 10x, T2 5x, T3 80%) materialize — the draw itself is a fixed
// slot draw. Returns the placed tile, or null if the pool is exhausted.
function sampleRinshan(state, slotIdx, weightOf) {
  if (slotIdx < 0 || slotIdx >= state.deadWall.length) return null;
  const t = state.pool.sample(weightOf);
  if (t === null) return null;
  const old = state.deadWall[slotIdx];
  state.deadWall[slotIdx] = t;
  state.pool.counts[old] = (state.pool.counts[old] || 0) + 1;
  return t;
}

module.exports = { createMatchState, setupDeadWall, dealHands, executeDrawStep, exchangeDeadWallSlot, sampleRinshan };

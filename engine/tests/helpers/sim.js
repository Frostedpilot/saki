// tests/helpers/sim.js — mini table simulator for cross-character tests.
// Drives the real engine path: core.executeDrawStep -> PowerDispatcher
// computeDrawWeights (self hooks + ALL field auras) -> DynamicPool.sample.
// Each table gets an isolated PowerDispatcher so scenarios never bleed.
const { createMatchState, setupDeadWall, executeDrawStep } = require('../../core');
const { PowerDispatcher } = require('../../powers');

// roster: [[seat, createHooksFn], ...]. Tables are isolated per instantiation.
function createTable({ seed = 1, nSeats, roster = [] } = {}) {
  const seats = nSeats || (roster.length ? Math.max(...roster.map((r) => r[0])) + 1 : 4);
  const state = createMatchState({ seed, nSeats: seats });
  state.powers = new PowerDispatcher();
  state.bakaze = 1; // East round default
  const hooks = new Map();
  for (const [seat, createFn] of roster) {
    const h = createFn(seat);
    state.powers.register(seat, h);
    hooks.set(seat, h);
    // Normal-type powers live outside the Flow economy: pin their gauge at 0.
    if (state.flow) {
      state.flow.setMode(seat, h && h.meta && h.meta.type === 'normal' ? 'normal' : 'flow');
    }
  }
  return { state, hooks, seats: [...Array(seats).keys()] };
}

// Phase 1: dead wall + random 13-tile deal for the listed seats.
function setup(state, seats = [0, 1, 2, 3]) {
  setupDeadWall(state);
  for (const seat of seats) {
    for (let k = 0; k < 13; k++) {
      const t = state.pool.sample();
      if (t === null) throw new Error('sim.setup: pool exhausted');
      state.players[seat].hand.push(t);
    }
  }
}

// Script a hand by decrementing from the FULL pool first (guaranteed legal).
function scriptHand(state, seat, hand) {
  for (const t of hand) state.pool.decrement(t);
  state.players[seat].hand = [...hand];
}

// Phase 1 dead wall only — for tests that script hands instead of dealing.
function deadWall(state) {
  return setupDeadWall(state);
}

function sumTiles(state) {
  let n = state.pool.total();
  for (const p of state.players) n += p.hand.length + p.discards.length + p.melds.length;
  n += state.deadWall.length;
  for (const t of Object.values(state.pool.slots)) n += 1;
  return n;
}

function auditProblems(state) {
  return state.pool.audit([...state.players.flatMap((p) => [p.hand, p.discards, p.melds]), state.deadWall]);
}

// Full weight map for `seat` (self hooks × all field auras). No RNG consumed.
function weightsSnapshot(state, seat, trajectory) {
  return state.powers.computeDrawWeights(seat, state, trajectory || {});
}

// One turn: draw (through the dispatcher) -> discard -> flow economy.
// opts.discard: 'tsumogiri' (default) | 'first' | 'keep-norms' -> discard a
// non-keep tile by hand-norm membership.
function runTurn(state, seat, turn, opts = {}) {
  const h = state.powers.hooksFor(seat);
  const drawn = executeDrawStep(seat, state);
  if (drawn === null) return { drawn: null, discarded: null, flowDelta: 0, weights: null };

  let discarded;
  if (opts.keepNorms && opts.keepNorms.size) {
    const hand = state.players[seat].hand;
    const need = hand.filter((t) => !opts.keepNorms.has(t));
    discarded = need.length ? need[0] : drawn;
  } else {
    discarded = drawn; // tsumogiri
  }

  // Flow economy: per-character generation + discard deltas (14-tile hand ctx).
  let flowDelta = 1.5;
  if (h.onFlowGeneration) {
    const gen = h.onFlowGeneration(state, turn);
    if (typeof gen === 'number') flowDelta = gen;
  }
  if (h.onDiscard) {
    const r = h.onDiscard(discarded, state) || {};
    if (r.flowDelta) flowDelta += r.flowDelta;
  }
  state.flow.addFlow(seat, flowDelta);

  // Commit the discard (hand currently has the 14th tile).
  const hand = state.players[seat].hand;
  const idx = hand.indexOf(discarded);
  if (idx >= 0) hand.splice(idx, 1);
  state.players[seat].discards.push(discarded);
  if (h.onTurnEnd) h.onTurnEnd(state);

  return { drawn, discarded, flowDelta };
}

// Run `rounds` full rotations over `axes` (every seat draws each round), or
// until the wall is exhausted. sampleEvery: persist weight maps + non-unit
// counts at that cadence for horizon assertions.
function runRounds(state, axes, rounds, opts = {}) {
  const { sampleEvery = 0 } = opts;
  const log = [];
  let turn = 0;
  outer: for (let r = 0; r < rounds; r++) {
    for (const seat of axes) {
      turn++;
      if (state.pool.total() <= 0) break outer;
      const entry = runTurn(state, seat, turn, opts);
      if (sampleEvery > 0 && turn % sampleEvery === 1 && entry.drawn !== null) {
        const w = weightsSnapshot(state, seat);
        entry.weights = Object.fromEntries(w);
        entry.nonUnit = Object.values(w).filter((v) => v !== 1.0).length;
      }
      log.push({ round: r + 1, seat, turn, ...entry });
    }
  }
  return { log, turns: turn };
}

module.exports = {
  createTable,
  setup,
  deadWall,
  scriptHand,
  runTurn,
  runRounds,
  weightsSnapshot,
  auditProblems,
  sumTiles,
};

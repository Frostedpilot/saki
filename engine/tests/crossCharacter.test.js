// crossCharacter.test.js — Cross-character interaction suite.
// Simulates PAIR tables (2 seats) and FULL 4-seat tables with real rosters,
// driving draws through the canonical engine path:
//   core.executeDrawStep -> PowerDispatcher.computeDrawWeights
//   (self hooks × ALL field auras) -> DynamicPool.sample
//
// Coverage:
//   A. Pair table, simple field interactions (exact multiplier math)
//   B. Pair table, flow economy interactions (drains, floors, caps)
//   C. 4-person table edge cases (slot contention, exhaustion, settlement
//      fan-out, counterplay, tenpai immunity, dispatcher teardown)
//   D. Long horizons (full-wall 4-person & pair tables, determinism)
//   E. Multi-hand chain (flow carry-over across hands inside a match)
const { test } = require('node:test');
const assert = require('node:assert/strict');

const sim = require('./helpers/sim');
const { createKoromoHooks, KOROMO } = require('../powers/rosters/koromo');
const { createHisaHooks, HISA, classifyWait } = require('../powers/rosters/hisa');
const { createNodokaHooks } = require('../powers/rosters/nodoka');
const { createSakiHooks, SAKI, passiveWeight } = require('../powers/rosters/kiyosumi');
const { createYuukiHooks } = require('../powers/rosters/yuuki');
const { createMakoHooks } = require('../powers/rosters/mako');
const { shantenOf, getOptimalBridges } = require('../powers/trajectoryPlanner');
const { PowerDispatcher, dispatcher } = require('../powers/index');
const { DynamicPool } = require('../powers/dynamicPool');
const { createRNG } = require('../rng');

// --- Shared hands (verified against syanten in the unit suites) ---
const TENPAI_HAND = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s']; // tenpai, wait 7s
const KOROMO_TP_B = ['9m', '9m', '9m', '5s', '5s', '5s', '4p', '4p', '4p', '1p', '2p', '3p', '6z']; // tenpai, wait 6z (never holds Saki's pin kinds 3s/7p)
const SAKI_SUMMIT_HAND = ['1m', '1m', '1m', '3s', '3s', '3s', '7p', '7p', '7p', '5m', '5m', '2p', '3p']; // 3 trips + 5m pair
const SHANTEN2_HAND = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z']; // shanten 2
const SAKI_PAIR_HAND = ['5m', '5m', '2p', '3p', '4p', '6s', '7s', '8s', '1z', '1z', '2z', '3z', '4z']; // sh 2, pair 5m
const YUUKI_TP_HAND = ['8s', '8s', '8s', '8p', '8p', '8p', '3z', '3z', '3z', '7s', '8s', '9s', '7z']; // tenpai, wait 7z (kinds avoid the 1m/3s/7p/2p/… kinds other hands triple)
const TENPAI_C = ['2p', '2p', '2p', '6s', '6s', '6s', '9p', '9p', '9p', '1m', '2m', '3m', '4z']; // tenpai, wait 4z (for 4-seat tables)

// Build an isolated field table with a Koromo enforcer at seat 0 by default.
// - fills the dead wall only (hands are scripted, no random deal)
// - overrides pool.counts when `counts` is given (object or fn(state))
//   so Koromo's wall-limit tier gates (T4 requires wall ≤ 14) can pass
// - applies flows and scores
function makeFieldTable({ seats = 2, roster = [[0, createKoromoHooks]], hands = { 0: TENPAI_HAND, 1: SHANTEN2_HAND }, counts, flows = {}, scores = {} } = {}) {
  const { state, hooks } = sim.createTable({ seed: 11, nSeats: seats, roster });
  for (const [s, hand] of Object.entries(hands)) sim.scriptHand(state, Number(s), hand);
  sim.deadWall(state); // dead wall takes only what the scripts left behind
  for (const [s, v] of Object.entries(flows)) state.flow.set(Number(s), v);
  for (const [s, v] of Object.entries(scores)) { (state.scores = state.scores || {})[Number(s)] = v; }
  if (typeof counts === 'function') state.pool.counts = counts(state);
  else if (counts) state.pool.counts = { ...counts };
  return { state, hooks };
}

// Koromo abyss-friendly tiny inventory: SHANTEN2 advancing tiles + a flat tile.
function abyssCounts() {
  return { '1m': 2, '4m': 2, '1s': 2, '4s': 2, '7s': 2, '1p': 2 }; // total 12 ≤ 14
}

// Expected weight for a Saki draw under a self×field stack: passive pair
// affinity (1.35) composed with Koromo's abyss dampening on advancing tiles.
function expectSakiField(hand, score) {
  const sh = shantenOf(hand);
  return (k) => {
    const self = passiveWeight(k, hand, score);
    const dampened = shantenOf([...hand, k]) < sh;
    return self * (dampened ? KOROMO.ABYSS_OPPONENT_MULT : 1.0);
  };
}

// =============================================================
// A. Pair table — simple cross-character field interactions
// =============================================================

test('A1: Koromo T2 mire dampens the lone opponent draw to exactly 0.60', () => {
  const { state, hooks } = makeFieldTable({ flows: { 0: 100 } });
  const r = hooks.get(0).tryActivateTier2(state, 10);
  assert.equal(r.ok, true);

  const w = sim.weightsSnapshot(state, 1); // opponent draws
  const broads = getOptimalBridges(SHANTEN2_HAND, state.pool, 4);
  for (const b of broads) {
    if (b in w) assert.equal(w[b], 0.60, `advancing tile ${b}`);
  }
  // flat tile (no shanten decrease) stays untouched
  if ('1p' in w) assert.equal(w['1p'], 1.0);
  // Koromo's own turn is not muddied by her own mire
  const own = sim.weightsSnapshot(state, 0);
  assert.equal(own['7s'], 1.0);
});

test('A2: Koromo T4 abyss dampens the lone opponent to exactly 0.20 and skips her own seat', () => {
  const { state, hooks } = makeFieldTable({ flows: { 0: 150 }, counts: abyssCounts() });
  const r = hooks.get(0).tryActivateTier4(state, state.pool.total());
  assert.equal(r.ok, true);
  assert.equal(r.anchorTile, '7s'); // her haitei anchor is her winning wait

  const w = sim.weightsSnapshot(state, 1);
  assert.equal(w['1m'], 0.20); // advancing
  assert.equal(w['4s'], 0.20); // advancing
  assert.equal(w['1p'], 1.0);  // flat

  const own = sim.weightsSnapshot(state, 0);
  assert.equal(own['1m'], 1.0); // enforcer not drowned in her own abyss
});

test('A3: 150% economy cap — T4 (150) and T2 (50) are mutually exclusive', () => {
  const mk = () => makeFieldTable({ flows: { 0: 150 }, counts: abyssCounts() });
  // T2 first: 150 -> 100, then T4 is unaffordable
  let { state, hooks } = mk();
  assert.equal(hooks.get(0).tryActivateTier2(state, 10).ok, true);
  const t4aftert2 = hooks.get(0).tryActivateTier4(state, state.pool.total());
  assert.equal(t4aftert2.ok, false);
  assert.equal(t4aftert2.reason, 'insufficient-flow');
  // T4 first: 150 -> 0, T2 unaffordable, but the field is fully abyssal
  ({ state, hooks } = mk());
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  assert.equal(hooks.get(0).tryActivateTier2(state, 10).ok, false);
  const w = sim.weightsSnapshot(state, 1);
  assert.equal(w['1m'], 0.20);
  assert.equal(w['1p'], 1.0);
});

test('A4: Saki passive pair affinity (1.35) × Koromo abyss (0.20) = 0.27; flat stays 1.0', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createKoromoHooks], [1, createSakiHooks]],
    hands: { 0: TENPAI_HAND, 1: SAKI_PAIR_HAND },
    counts: { '5m': 3, '1z': 2, '5p': 2, '8s': 2 }, // total 9 ≤ 14
    flows: { 0: 150, 1: 0 },
    scores: { 1: 25000 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  const sh = shantenOf(SAKI_PAIR_HAND);
  assert.equal(sh, 2);

  const w = sim.weightsSnapshot(state, 1);
  const expect = expectSakiField(SAKI_PAIR_HAND, 25000);
  for (const k of Object.keys(w)) {
    assert.ok(Math.abs(w[k] - expect(k)) < 1e-9, `weight ${k} = ${w[k]}`);
  }
  assert.equal(w['5m'], 1.35 * 0.20); // pair + advancing -> 0.27
});

test('A4b: out of equilibrium Saki loses affinity but field dampening still applies', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createKoromoHooks], [1, createSakiHooks]],
    hands: { 0: TENPAI_HAND, 1: SAKI_PAIR_HAND },
    counts: { '5m': 3, '1p': 2 }, // total 5 ≤ 14
    flows: { 0: 150 },
    scores: { 1: 32000 }, // far outside the equilibrium band
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  const w = sim.weightsSnapshot(state, 1);
  assert.equal(w['5m'], 0.20); // affinity gone (1.0), abyss still applies
});

test('A5: Nodoka T3 bridge magnet (15.0) survives abyss on non-tenpai draw at 3.0', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createKoromoHooks], [1, createNodokaHooks]],
    hands: { 0: TENPAI_HAND, 1: SHANTEN2_HAND },
    counts: { '1m': 2, '4m': 2, '1s': 2, '4s': 2, '7s': 2, '1z': 2, '1p': 2 }, // 14 ≤ 14
    flows: { 0: 150, 1: 100 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  assert.equal(hooks.get(1).tryActivateTier3(state).ok, true); // sh 1-2 gate

  const w = sim.weightsSnapshot(state, 1);
  const b = getOptimalBridges(SHANTEN2_HAND, state.pool, 2)[0];
  assert.equal(w[b], 15.0 * 0.20); // self 15.0 × field 0.20
  if ('1p' in w) assert.equal(w['1p'], 1.0); // flat, not a bridge
});

test('A6: tenpai immunity — Koromo abyss cannot dampen a finished opponent\u2019s hand', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createKoromoHooks], [1, createSakiHooks]],
    hands: { 0: TENPAI_HAND, 1: YUUKI_TP_HAND }, // seat 1 is tenpai (wait 1z)
    counts: { '1z': 2, '6z': 2, '1p': 2 }, // total 6 ≤ 14
    flows: { 0: 150 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  assert.equal(shantenOf(YUUKI_TP_HAND), 0);
  const w = sim.weightsSnapshot(state, 1);
  for (const k of Object.keys(w)) assert.equal(w[k], 1.0, `tenpai guard keeps ${k} at 1.0`);
});

test('A7: Nodoka T4 EV Singularity magnet (4.0) holds at 4.0 under abyss (tenpai immunity)', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createKoromoHooks], [1, createNodokaHooks]],
    hands: { 0: TENPAI_HAND, 1: KOROMO_TP_B }, // seat 1 tenpai, wait 6z
    counts: { '6z': 2, '7s': 2, '1p': 2 }, // total 6 ≤ 14
    flows: { 0: 150, 1: 150 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  assert.equal(hooks.get(1).tryActivateTier4(state).ok, true); // tenpai node
  const w = sim.weightsSnapshot(state, 1);
  assert.equal(w['6z'], 4.0); // won through her own win magnet, abyss skipped
  assert.equal(w['1p'], 1.0); // safe-tile branch, still full weight
});

// =============================================================
// B. Pair table — flow economy interactions
// =============================================================

test('B1: Hisa Showmanship Slam drains only the lone opponent, gauges stay numeric', () => {
  const { state, hooks } = sim.createTable({
    seed: 5, nSeats: 2,
    roster: [[0, createHisaHooks], [1, createYuukiHooks]],
  });
  sim.scriptHand(state, 0, TENPAI_HAND);
  sim.scriptHand(state, 1, SHANTEN2_HAND);
  sim.deadWall(state);
  state.flow.set(0, 50);
  state.flow.set(1, 30);

  assert.equal(hooks.get(0).onDeclareRiichi(state).event.type, 'SHOWMANSHIP_SLAM');
  assert.equal(state.flow.get(0), 50); // slam hits opponents, not self
  assert.equal(state.flow.get(1), 20); // 30 - 10
  assert.equal(state.flow.gauges.every(Number.isFinite), true); // no NaN from 2-seat table
  // out-of-range drains (seats 2..3 on a 2-seat table) are no-ops
  assert.equal(state.flow.get(2), 0);

  // 20 < 25 => Yuuki's Quick Bite is now unaffordable
  assert.equal(hooks.get(1).tryActivateTier1(state, 4).ok, false);
  assert.equal(hooks.get(1).tryActivateTier1(state, 4).reason, 'insufficient-flow');
});

test('B2: Hisa hell-wait Riichi drains opponents AND banks +30 herself', () => {
  const { state, hooks } = sim.createTable({
    seed: 6, nSeats: 2,
    roster: [[0, createHisaHooks], [1, createMakoHooks]],
  });
  sim.scriptHand(state, 0, TENPAI_HAND); // wait 7s
  sim.scriptHand(state, 1, SHANTEN2_HAND);
  sim.deadWall(state);
  // exhaust the wall down to ≤1 live 7s copy (park extras in discards)
  while (state.pool.get('7s') > 1) {
    state.pool.decrement('7s');
    state.players[1].discards.push('7s');
  }
  const info = classifyWait(TENPAI_HAND, state.pool);
  assert.equal(info.type, 'hell');

  state.flow.set(0, 0);
  state.flow.set(1, 35);
  hooks.get(0).onDeclareRiichi(state);
  assert.equal(state.flow.get(0), 30); // hell-wait riichi bonus
  assert.equal(state.flow.get(1), 25); // drained by 10
  // conservation still holds: 3 parked copies live in the discard pile
  assert.deepEqual(sim.auditProblems(state), []);
});

test('B3: flow floor — a slam cannot push an opponent below 0', () => {
  const { state, hooks } = sim.createTable({
    seed: 7, nSeats: 2,
    roster: [[0, createHisaHooks], [1, createYuukiHooks]],
  });
  sim.scriptHand(state, 0, TENPAI_HAND);
  sim.scriptHand(state, 1, SHANTEN2_HAND);
  state.flow.set(1, 4);
  hooks.get(0).onDeclareRiichi(state);
  assert.equal(state.flow.get(1), 0);
  assert.ok(state.flow.get(1) >= 0);
});

test('B4: flow cap — late-tenpai bonus and discard bonuses clamp at 150', () => {
  const { state, hooks } = sim.createTable({ seed: 8, nSeats: 2, roster: [[0, createKoromoHooks], [1, createNodokaHooks]] });
  state.flow.set(0, 140);
  const r = hooks.get(0).onEnterTenpai(state, 10); // wall ≤ 20 -> +25
  assert.equal(r.event.type, 'LATE_TENPAI_BONUS');
  assert.equal(state.flow.get(0), 150); // 140 + 25 clamped at 150

  state.flow.set(1, 146);
  state.flow.addFlow(1, 10);
  assert.equal(state.flow.get(1), 150);
});

// =============================================================
// C. 4-person table — edge cases
// =============================================================

test('C1: Saki T3 dead-wall pins + Koromo slot reservation coexist, conservation intact', () => {
  const { state, hooks } = sim.createTable({
    seed: 21, nSeats: 4,
    roster: [[0, createSakiHooks], [1, createKoromoHooks]],
  });
  sim.scriptHand(state, 0, SAKI_SUMMIT_HAND);
  sim.scriptHand(state, 1, KOROMO_TP_B); // distinct kinds — no pool copy conflicts
  // dead wall: sample 14 tiles, but NEVER the T3 pin kinds (3s / 7p)
  for (let i = 0; i < 14; i++) {
    state.deadWall.push(state.pool.sample(t => (t === '3s' || t === '7p') ? 0 : 1));
  }

  // Koromo reserved her haitei anchor engine-side (Slot Reserver primitive)
  assert.equal(state.pool.reserveSlot('7s', 'LAST_LIVE_TILE'), true);
  state.flow.set(0, 100); // Saki's Triple Summit budget

  const r = hooks.get(0).tryActivateTier3(state, 1);
  assert.equal(r.ok, true);
  assert.equal(r.pinned, true);
  // Guaranteed current rinshan + chained 4th copies coexist with Koromo slot.
  assert.ok(r.pins.includes('3s') && r.pins.includes('7p'));
  assert.equal(state.deadWall[0], r.pin);

  // wanpai stays exactly 14 tiles, swaps only
  assert.equal(state.deadWall.length, 14);
  assert.ok(['3s', '7p'].includes(state.deadWall[1]));
  assert.ok(['3s', '7p'].includes(state.deadWall[2]));
  assert.equal(state.pool.slots.LAST_LIVE_TILE, '7s');
  // nothing lost, nothing duplicated across all four accounting buckets
  assert.deepEqual(sim.auditProblems(state), []);
  assert.equal(sim.sumTiles(state), 136);
});

test('C2: Saki T2 fallback when the 4th copy sits in another character\u2019s hand', () => {
  const { state, hooks } = sim.createTable({
    seed: 22, nSeats: 4,
    roster: [[0, createSakiHooks], [1, createYuukiHooks]],
  });
  sim.scriptHand(state, 0, SAKI_SUMMIT_HAND);      // holds 3× 3s
  sim.scriptHand(state, 1, ['3s', '8p', '8p', '8p', '9p', '9p', '9p', '4s', '4s', '4s', '6z', '6z', '6z']); // holds the 4th 3s
  sim.deadWall(state);
  state.flow.set(0, 50);

  const r = hooks.get(0).tryActivateTier2(state);
  assert.equal(r.ok, true);
  assert.equal(r.pinned, true, 'current rinshan still guaranteed despite exhausted chain');
  assert.equal(r.kanTile, null);
  assert.equal(state.flow.get(0), 0); // 50 - 50 full cost (guarantee succeeded, no refund)
  assert.deepEqual(sim.auditProblems(state), []);
  assert.equal(sim.sumTiles(state), 136);
});

test('C3: field stacking — two enforcers compose multiplicatively, order-independent', () => {
  const plugin = (mult) => ({
    applyFieldAura: (drawSeat, w) => {
      for (const k of Object.keys(w)) w[k] = (w[k] || 1.0) * mult;
      return w;
    },
  });
  const run = (order) => {
    const d = new PowerDispatcher();
    for (const [seat, mult] of order) d.register(seat, plugin(mult));
    const pool = DynamicPool.full(createRNG(3));
    const state = { pool, players: [{ hand: [] }, { hand: [] }, { hand: [] }] };
    return d.computeDrawWeights(0, state, {});
  };
  const a = run([[1, 0.6], [2, 0.8]]);
  const b = run([[2, 0.8], [1, 0.6]]);
  assert.deepEqual(a, b);
  const k = Object.keys(a)[0];
  assert.equal(a[k], 0.48);
});

test('C4: Koromo field skips an un-dealt (empty-hand) draw seat', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    hands: { 0: TENPAI_HAND }, // seat 1 never dealt
    counts: { '1m': 5, '9z': 2 },
    flows: { 0: 150 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);
  const w = sim.weightsSnapshot(state, 1);
  for (const k of Object.keys(w)) assert.equal(w[k], 1.0, `empty hand keeps ${k} at 1.0`);
});

test('C5: settlement fan-out — RINSHAN / EV tsumo consume only their owner, tag-gated', () => {
  const roster = [[0, createSakiHooks], [1, createNodokaHooks], [2, createHisaHooks], [3, createKoromoHooks]];
  const { state, hooks } = sim.createTable({ seed: 23, nSeats: 4, roster });
  for (const [s, hand] of [[0, SAKI_SUMMIT_HAND], [1, SHANTEN2_HAND], [2, TENPAI_C], [3, YUUKI_TP_HAND]]) {
    sim.scriptHand(state, s, hand);
  }
  sim.deadWall(state);
  state.flow.set(0, 80); state.flow.set(1, 120); state.flow.set(2, 60); state.flow.set(3, 40);

  state.powers.onSettlement({ type: 'tsumo', winner: 0, tag: 'RINSHAN_RESONANCE_TRIGGER' }, state);
  assert.equal(state.flow.get(0), 0, 'Saki spent everything on the rinshan win');
  assert.equal(state.flow.get(1), 120, 'Nodoka untouched by Saki\u2019s tag');
  assert.equal(state.flow.get(2), 60, 'Hisa untouched');
  assert.equal(state.flow.get(3), 40, 'Koromo untouched');

  state.powers.onSettlement({ type: 'tsumo', winner: 1, tag: 'EV_SINGULARITY' }, state);
  assert.equal(state.flow.get(1), 0, 'Nodoka consumed on her own EV win');
  assert.equal(state.flow.get(0), 0);

  // tag-less tsumo: nobody reacts
  state.flow.set(0, 40);
  const before = state.flow.gauges.slice();
  state.powers.onSettlement({ type: 'tsumo', winner: 0 }, state);
  assert.deepEqual(state.flow.gauges, before);

  // wrong winner: Saki doesn't consume on someone else's RINSHAN win
  state.flow.set(0, 50);
  state.powers.onSettlement({ type: 'tsumo', winner: 3, tag: 'RINSHAN_RESONANCE_TRIGGER' }, state);
  assert.equal(state.flow.get(0), 50);
});

test('C6: Koromo haitei counterplay — opponent melds steal the abyss anchor', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    hands: { 0: TENPAI_HAND, 1: SHANTEN2_HAND },
    counts: { '7s': 4, '1p': 2 },
    flows: { 0: 150 },
  });
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);

  hooks.get(0).onOpponentMeld(1);
  hooks.get(0).onOpponentMeld(1);
  assert.equal(hooks.get(0).onSettlement({ type: 'tsumo', winner: 0 }, state).haiteiWinRate, 0.50);
  hooks.get(0).onOpponentMeld(1); // third call outright steals the tile
  const res = hooks.get(0).onSettlement({ type: 'tsumo', winner: 0 }, state);
  assert.equal(res.haiteiWinRate, 0);
  assert.equal(res.counterplayCalls, 3);
});

test('C7: Hisa T4 Hell Dominance mitigates deal-ins (ron-from-her) but not self tsumos', () => {
  const { state, hooks } = makeFieldTable({
    seats: 2,
    roster: [[0, createHisaHooks]],
    hands: { 0: TENPAI_HAND, 1: SHANTEN2_HAND },
    counts: { '7s': 1, '1p': 2, '9z': 2 }, // wall 5 ≤ 25
    flows: { 0: 150 },
  });
  const info = classifyWait(TENPAI_HAND, state.pool);
  assert.equal(info.type, 'hell');
  assert.equal(hooks.get(0).tryActivateTier4(state, state.pool.total()).ok, true);

  assert.equal(hooks.get(0).onSettlement({ type: 'ron', from: 0, winner: 1 }, state).scoreMultiplier, HISA.DAMAGE_MITIGATION);
  assert.deepEqual(hooks.get(0).onSettlement({ type: 'tsumo', winner: 0 }, state), {});
});

test('C8: shared singleton dispatcher aggregates field auras cross-seat and clears cleanly', () => {
  const d = dispatcher;
  d.register(0, { applyFieldAura: (drawSeat, w) => {
    for (const k of Object.keys(w)) w[k] = (w[k] || 1.0) * 0.5;
    return w;
  } });
  d.register(1, { onPowerDraw: () => 2.0 });
  const pool = DynamicPool.full(createRNG(4));
  const state = { pool, players: [{ hand: [] }, { hand: [] }] };
  const w = d.computeDrawWeights(1, state, {});
  const k = Object.keys(w)[0];
  assert.equal(w[k], 2.0 * 0.5, 'seat-1 self boost × seat-0 field aura');

  d.clear(0); d.clear(1);
  const w2 = d.computeDrawWeights(1, state, {});
  assert.equal(w2[k], 1.0, 'cleared dispatcher samples uniformly');
});

// =============================================================
// D. Long horizons
// =============================================================

const FULL_ROSTER = [[0, createSakiHooks], [1, createKoromoHooks], [2, createNodokaHooks], [3, createYuukiHooks]];

// Full 4-seat match: random deal, Koromo opens the mire at turn 10, everything
// else flows through the canonical draw path until the wall is exhausted.
function simulateMatch(seed) {
  const { state, hooks } = sim.createTable({ seed, nSeats: 4, roster: FULL_ROSTER });
  state.bakaze = 1;
  sim.setup(state, [0, 1, 2, 3]);
  state.flow.set(1, 60); // Koromo can afford the mire (50) at turn 10
  const events = [];
  let turn = 0;
  const samples = [];
  while (state.pool.total() > 0 && turn < 400) {
    for (const seat of [0, 1, 2, 3]) {
      turn++;
      if (state.pool.total() <= 0) break;
      if (turn === 10) {
        const r = hooks.get(1).tryActivateTier2(state, 10); // mire window 8-14
        if (r.ok) events.push('MIRE');
      }
      const entry = sim.runTurn(state, seat, turn);
      events.push(`${seat}:${entry.drawn}`);
      // sample broadly: the opening 8 turns for trajectory-shaper boosts, and
      // the whole mire window (turns 10-32) to catch enforcer dampening
      if (turn <= 8 || (turn >= 10 && turn <= 32)) {
        const w = sim.weightsSnapshot(state, seat);
        samples.push({ seat, turn, w });
      }
    }
  }
  return { drawLog: events, samples, problems: sim.auditProblems(state), sum: sim.sumTiles(state), gauges: state.flow.gauges.slice(), turns: turn };
}

test('D1: 4-seat full-wall horizon — conservation, gauge bounds, live field effects', () => {
  const m = simulateMatch(4242);
  assert.ok(m.turns > 50, 'ran a meaningful share of the wall');
  assert.deepEqual(m.problems, [], 'tile conservation holds across the whole match');
  assert.equal(m.sum, 136);
  for (const g of m.gauges) assert.ok(g >= 0 && g <= 150, `gauge ${g} inside [0,150]`);

  // both dampened (<1) and boosted (>1) draws occurred — field + self live
  let min = Infinity, max = -Infinity;
  for (const s of m.samples) {
    for (const v of Object.values(s.w)) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  assert.ok(min < 1.0, `some draw was dampened by a field enforcer (min ${min})`);
  assert.ok(max > 1.0, `some draw was boosted by a trajectory shaper (max ${max})`);
});

test('D2: long-horizon determinism — identical seed reproduces the exact match', () => {
  const a = simulateMatch(777);
  const b = simulateMatch(777);
  assert.deepEqual(a.drawLog, b.drawLog, 'identical sampled draws');
  assert.deepEqual(a.gauges, b.gauges, 'identical ending gauges');
  assert.deepEqual(a.samples, b.samples, 'identical weight snapshots');
  assert.deepEqual(a.problems, b.problems);
});

test('D3: pair-table horizon — Hisa + Mako full life of the wall, conservation + bounded flow', () => {
  const { state, hooks } = sim.createTable({
    seed: 99, nSeats: 2,
    roster: [[0, createHisaHooks], [1, createMakoHooks]],
  });
  sim.setup(state, [0, 1]);

  // Mako's delayed ignition: dormant through turn 6, then the ramp starts
  const res = sim.runRounds(state, [0, 1], 3); // 6 turns
  assert.equal(state.flow.get(1), 0, 'Mako dormant during her ignition window');
  assert.equal(state.flow.get(0), 3 * 1.5, 'Hisa banks the base flow');

  const untilEnd = sim.runRounds(state, [0, 1], 500);
  assert.ok(untilEnd.turns > 60, 'wall ran to exhaustion');
  assert.deepEqual(sim.auditProblems(state), []);
  assert.equal(sim.sumTiles(state), 136);
  for (const g of state.flow.gauges) assert.ok(g >= 0 && g <= 150);
});

// =============================================================
// E. Multi-hand chain (flow carries across hands inside a match)
// =============================================================

function runChain(seed) {
  const hands = [];
  let carry = null;
  for (let h = 0; h < 3; h++) {
    const { state, hooks } = sim.createTable({
      seed: seed + h * 1013, nSeats: 4, roster: FULL_ROSTER,
    });
    if (carry) carry.forEach((v, s) => state.flow.set(s, v)); // previous hand's gauges carry
    sim.setup(state, [0, 1, 2, 3]);
    // first 3 rounds, then Koromo opens the mire, then run to exhaustion
    sim.runRounds(state, [0, 1, 2, 3], 3);
    hooks.get(1).tryActivateTier2(state, 10);
    const rest = sim.runRounds(state, [0, 1, 2, 3], 999);
    hands.push({
      hand: h,
      turns: rest.turns,
      gauges: state.flow.gauges.slice(),
      problems: sim.auditProblems(state),
      sum: sim.sumTiles(state),
    });
    carry = state.flow.gauges.slice();
  }
  return hands;
}

test('E1: 3-hand chain — flow carries across hands, conservation per hand, bounded always', () => {
  const hands = runChain(31337);
  assert.equal(hands.length, 3);
  for (const h of hands) {
    assert.ok(h.turns > 30, `hand ${h.hand} ran a real share of the wall`);
    assert.deepEqual(h.problems, [], `hand ${h.hand} conserves all 136 tiles`);
    assert.equal(h.sum, 136);
    for (const g of h.gauges) assert.ok(g >= 0 && g <= 150, `gauge ${g} in [0,150]`);
  }
  // flow genuinely carried from hand 0 into hand 1 (non-trivial starting gauge)
  assert.ok(hands[1].gauges.some(g => g > 0), 'carried gauges are nonzero');
});

test('E2: chain determinism — identical chain from the same seed', () => {
  assert.deepEqual(runChain(555), runChain(555));
});
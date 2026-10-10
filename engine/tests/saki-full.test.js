const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../powers/rosters/kiyosumi');
const { createMatchState, setupDeadWall } = require('../core');
const { shantenOf } = require('../powers/trajectoryPlanner');

const T2_HAND = ['7p', '7p', '7p', '3s', '3s', '3s', '1m', '2m', '3m', '4p', '6p', '1z', '2z'];
const T3_HAND = ['7p', '7p', '7p', '3s', '3s', '3s', '1z', '1z', '1m', '2m', '3m', '4p', '5p'];
const T4_HAND = ['7p', '7p', '7p', '3s', '3s', '3s', '1m', '1m', '1m', '4p', '5p', '6p', '1z'];

// Scripted Saki hand taken from the FULL pool first (guaranteed available),
// dead wall + seats 1..3 dealt after. `protect` kinds are withheld from
// dead/others dealing (restored after) so pins/waits stay live deterministically.
function sakiState(hand, seed = 101, score = 25000, protect = []) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  const stashed = {};
  for (const k of protect) {
    stashed[k] = s.pool.get(k);
    if (stashed[k]) {
      for (let i = 0; i < stashed[k]; i++) s.pool.decrement(k);
    }
  }
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  for (const [k, n] of Object.entries(stashed)) s.pool.counts[k] = (s.pool.counts[k] || 0) + n;
  s.scores = [25000, 25000, 25000, 25000];
  s.scores[0] = score;
  return s;
}

function auditParts(s) {
  return [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
}

// --- Census helpers ---
test('closedTriplets / closedPairs census (aka-aware, sorted)', () => {
  assert.deepEqual(S.closedTriplets(T4_HAND), ['1m', '3s', '7p']);
  assert.deepEqual(S.closedPairs(T3_HAND), ['1z']);
  assert.deepEqual(S.closedPairs(T4_HAND), []);
  assert.deepEqual(S.closedTriplets(['5m', '5m', '0m', '1p']), ['5m']);
});

test('physicalCopy prefers exact kind, then aka, then null', () => {
  const s = sakiState(T2_HAND, 1, 25000, ['7p']);
  assert.equal(S.physicalCopy(s.pool, '7p'), '7p');
  while (s.pool.get('7p')) s.pool.decrement('7p');
  s.players[1].discards.push('7p'); // keep audit honest-ish (not audited here)
  assert.equal(S.physicalCopy(s.pool, '5m'), s.pool.get('5m') ? '5m' : '0m');
  assert.equal(S.physicalCopy(s.pool, '9z-nope'), null);
});

// --- Tier 2 (guaranteed current rinshan + chained next kan) ---
test('T2 success: guarantees current rinshan and chains 4th copy into deadWall[1], flow 50 consumed', () => {
  const s = sakiState(T2_HAND, 2, 25000, ['7p']);
  assert.deepEqual(S.closedTriplets(T2_HAND), ['3s', '7p']); // trips[1] = 7p
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier2(s);
  assert.equal(res.ok, true);
  assert.equal(res.fallback, undefined);
  assert.equal(res.pinned, true);
  assert.ok(res.pin, 'current rinshan guaranteed');
  assert.equal(s.deadWall[0], res.pin, 'on-deck slot holds guaranteed rinshan');
  assert.ok(res.kanTile === '7p', 'next kan chained');
  assert.equal(s.deadWall[1], '7p'); // 4th copy chained -> Kan #2 tile
  assert.equal(s.deadWall.length, 14);
  assert.equal(s.flow.get(0), 50);
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('T2 slot1 carries 5x wait boost', () => {
  const s = sakiState(T2_HAND, 3, 25000, ['7p']);
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier2(s);
  assert.equal(res.ok, true);
  assert.ok(res.waits.length > 0);
  assert.equal(res.weightOf(res.waits[0]), 5.0);
  assert.equal(res.weightOf('9z-nope-kind'), 1.0);
});

test('T2 fallback: exhausted chain still guarantees current (no refund when win live)', () => {
  const s = sakiState(T2_HAND, 4, 25000, ['7p']);
  // exhaust the protected 4th 7p: last copy goes to an opponent's hand (accounted)
  assert.equal(s.pool.get('7p'), 1);
  s.pool.decrement('7p');
  s.players[1].hand.push('7p');
  assert.equal(S.physicalCopy(s.pool, '7p'), null);
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier2(s);
  assert.equal(res.ok, true);
  // Chain tile unavailable, but current rinshan still guaranteed -> full cost.
  assert.equal(res.kanTile, null);
  assert.equal(res.pinned, true);
  assert.equal(s.deadWall[0], res.pin);
  assert.equal(s.flow.get(0), 50); // 100 - 50 (no refund; guarantee succeeded)
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('T2 precondition: <2 triplets rejected, flow untouched', () => {
  const s = sakiState(['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '2z', '3z', '4z'], 5);
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier2(s);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'precondition');
  assert.equal(s.flow.get(0), 100);
});

test('T2 kan chain: chained deadWall[1] completes the quad', () => {
  const s = sakiState(T2_HAND, 6, 25000, ['7p']);
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier2(s);
  assert.equal(res.kanTile, '7p');
  const drawn = s.deadWall[1];
  assert.equal(drawn, '7p');
  s.players[0].hand.push(drawn);
  const n = s.players[0].hand.filter((t) => t === '7p' || t === '0m').length;
  assert.equal(n, 4); // Kan #2 declarable
});

// --- Tier 3 (guaranteed current + chained pins + best dora) ---
test('T3 success: current guaranteed + chain pins + dora seeded to hand + 80% weights', () => {
  const s = sakiState(T3_HAND, 7, 25000, ['7p', '3s']);
  s.flow.set(0, 150);
  const res = S.createSakiHooks(0).tryActivateTier3(s, 1);
  assert.equal(res.ok, true);
  assert.equal(res.pinned, true);
  assert.equal(s.deadWall[0], res.pin, 'on-deck slot is guaranteed rinshan');
  assert.ok(res.pins.length >= 2);
  assert.equal(s.deadWall.length, 14);
  // dora indicator points at a held tile (or null when no candidate)
  if (res.dora !== null) {
    const held = new Set(s.players[0].hand.map((t) => (t[0] === '0' ? '5' + t[1] : t)));
    assert.ok(held.has(res.dora.dora), `dora ${res.dora.dora} not in hand`);
  }
  // combined wait probability under slot2 weights ~= 80% (placement itself
  // mutates the pool by one tile, so allow slot-noise tolerance here; the
  // exact calibration is covered by the pure-helper test below)
  let n = 0,
    others = 0;
  for (const k of Object.keys(s.pool.counts)) {
    const w = res.weightOf(k);
    if (w > 1.0) n += (s.pool.get(k) || 0) * w;
    else others += s.pool.get(k) || 0;
  }
  const p = n / (n + others);
  assert.ok(Math.abs(p - 0.8) < 0.06, `win prob ${p}`);
  assert.equal(s.flow.get(0), 50);
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('winProbabilityWeights calibrates exactly on a static pool', () => {
  const s = sakiState(T3_HAND, 70, 25000, ['7p', '3s']);
  const { waits, weightOf } = S.winProbabilityWeights(s.players[0].hand, s.pool, 0.8);
  assert.ok(waits.length > 0);
  let n = 0,
    others = 0;
  for (const k of Object.keys(s.pool.counts)) {
    if (weightOf(k) > 1.0) n += (s.pool.get(k) || 0) * weightOf(k);
    else others += s.pool.get(k) || 0;
  }
  const p = n / (n + others);
  assert.ok(Math.abs(p - 0.8) < 0.01, `win prob ${p}`);
});

test('T3 precondition: needs 2 triplets + 1 pair', () => {
  const s = sakiState(T2_HAND, 8); // 2 trips, 0 pairs
  s.flow.set(0, 150);
  const res = S.createSakiHooks(0).tryActivateTier3(s, 1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'precondition');
  assert.equal(s.flow.get(0), 150);
});

// --- Tier 4 ---
test('T4 Branch A: live wait pinned into deadWall[3], wanpai intact', () => {
  const s = sakiState(T4_HAND, 9, 25000, ['1z']);
  s.flow.set(0, 150);
  const res = S.createSakiHooks(0).tryActivateTier4(s, 1);
  assert.equal(res.ok, true);
  assert.equal(res.branch, 'win');
  assert.equal(s.deadWall[3], res.haiteiSlot3);
  const { norm } = require('../tiles');
  assert.equal(norm(s.deadWall[3]), '1z'); // winning wait at the tail
  assert.equal(s.deadWall.length, 14);
  assert.equal(s.flow.get(0), 0);
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('T4 Branch B: wait exhausted -> Kan #3 fallback with live completer', () => {
  const s = sakiState(T4_HAND, 10);
  // exhaust the 1z wait: remaining copies accounted into discards
  while (s.pool.get('1z')) {
    s.pool.decrement('1z');
    s.players[1].discards.push('1z');
  }
  s.flow.set(0, 150);
  const res = S.createSakiHooks(0).tryActivateTier4(s, 1);
  assert.equal(res.ok, true);
  assert.equal(res.branch, 'fallback');
  assert.deepEqual(res.waits, []);
  assert.ok(typeof res.rinshanSlot2 === 'string');
  assert.equal(s.deadWall.length, 14);
  assert.equal(s.flow.get(0), 0);
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('T4 precondition: <3 triplets rejected', () => {
  const s = sakiState(T3_HAND, 11); // 2 trips + pair
  s.flow.set(0, 150);
  const res = S.createSakiHooks(0).tryActivateTier4(s, 1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'precondition');
  assert.equal(s.flow.get(0), 150);
});

test('T4 insufficient flow rejected', () => {
  const s = sakiState(T4_HAND, 12);
  s.flow.set(0, 149.9);
  assert.equal(S.createSakiHooks(0).tryActivateTier4(s, 1).ok, false);
});

// --- Phase 0 shaping ---
test('shapeSakiStartingHand: >=2 triplets + pair, shanten 2..3, audit clean', () => {
  const s = createMatchState({ seed: 77 });
  const hand = S.shapeSakiStartingHand(s.pool);
  assert.ok(hand !== null && hand.length === 13);
  assert.ok(S.closedTriplets(hand).length >= 2);
  assert.ok(S.closedPairs(hand).length >= 1);
  const sh = shantenOf(hand);
  assert.ok(sh >= 2 && sh <= 3, `shanten ${sh}`);
  s.players[0].hand = hand;
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
});

test('shapeSakiStartingHand deterministic per seed', () => {
  const mk = () => {
    const s = createMatchState({ seed: 555 });
    return S.shapeSakiStartingHand(s.pool);
  };
  assert.deepEqual(mk(), mk());
});

// --- Full-tree long chain: T2 -> T3 -> T4 across one deep-wall hand ---
test('long chain: successive activations keep 14-tile wanpai + conservation', () => {
  const s = sakiState(T4_HAND, 13, 25000, ['1z', '3s', '7p', '1m']);
  s.flow.set(0, 150);
  const hooks = S.createSakiHooks(0);
  // T2 first (50), then top up to afford T4 (150) to simulate multi-hand carry
  const r2 = hooks.tryActivateTier2(s);
  assert.equal(r2.ok, true);
  assert.equal(s.deadWall.length, 14);
  s.flow.set(0, 150);
  const r4 = hooks.tryActivateTier4(s, 2);
  assert.equal(r4.ok, true);
  assert.equal(s.deadWall.length, 14);
  assert.deepEqual(s.pool.audit(auditParts(s)), []);
  // every slotted tile physically exists (no 5th copies)
  const { fullCounts } = require('../tiles');
  const full = fullCounts();
  const seen = {};
  for (const arr of auditParts(s)) for (const t of arr) seen[t] = (seen[t] || 0) + 1;
  for (const [k, n] of Object.entries(seen)) assert.ok(n <= full[k], `${k} overdrawn`);
});

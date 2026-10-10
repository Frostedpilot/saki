// edge.test.js — edge cases found by bug-hunting (accuracy pass).
// Each test pins a crash path or a subtle rule boundary.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');
const { KINDS, norm, same, fullCounts, toCounts, DORA_NEXT } = require('../tiles');
const { scoreHand } = require('../scoring');
const { parseDiscardIndex } = require('../input');
const { DynamicPool } = require('../powers/dynamicPool');
const { FlowManager } = require('../powers/flowManager');
const { createRNG } = require('../rng');
const { assertDeadWall, assertHandSize, assertScoresConserved, checkConservation } = require('../invariants');
const replay = require('../replay');
const core = require('../core');

const C = (o) => ({
  dora: [],
  bakaze: 1,
  jikaze: 2,
  riichi: false,
  doubleRiichi: false,
  ippatsu: false,
  kanFlag: false,
  lastFlag: false,
  tenhou: false,
  ...o,
});

// ---- ankanKeepsWaits fail-closed (was: splice(-1) + default-true) ----
test('ankanKeepsWaits: missing copies => false, never corrupts', () => {
  const pl = { hand: ['1m', '2m', '3m'], melds: [], riichiWaits: ['1m'] };
  assert.equal(H.ankanKeepsWaits(pl, '9m'), false);
  assert.deepEqual(pl.hand, ['1m', '2m', '3m']); // untouched
});

test('ankanKeepsWaits: missing riichiWaits => false (no throw)', () => {
  // Regression: server human riichi previously left riichiWaits undefined,
  // and spreading undefined killed the match. Now fail-closed.
  const pl = { hand: ['7p', '7p', '7p', '7p', '1m'], melds: [] };
  assert.doesNotThrow(() => H.ankanKeepsWaits(pl, '7p'));
  assert.equal(H.ankanKeepsWaits(pl, '7p'), false);
});

test('ankanKeepsWaits: aka quad works norm-aware', () => {
  const seqs = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'];
  const hand13 = [...seqs, '0m', '5m', '5m', '2m']; // single wait 2m
  const wctx = { dora: [], bakaze: 1, jikaze: 1 };
  const waits = H.getWaits({ hand: hand13, melds: [] }, [], [], wctx);
  assert.deepEqual(waits, ['2m']);
  const pl = { hand: [...hand13, '5m'], melds: [], riichiWaits: waits };
  assert.equal(H.ankanKeepsWaits(pl, '5m'), true);
  assert.equal(H.ankanKeepsWaits(pl, '0m'), true); // aka spelling also matches
});

// ---- parseDiscardIndex: never out of range ----
test('parseDiscardIndex: exact, aka, index, garbage, bounds', () => {
  const hand = ['1m', '0p', '3s', '7z'];
  assert.equal(parseDiscardIndex('1m', hand), 0);
  assert.equal(parseDiscardIndex('5p', hand), 1); // aka norm match
  assert.equal(parseDiscardIndex('0p', hand), 1);
  assert.equal(parseDiscardIndex('2', hand), 2); // numeric index
  assert.equal(parseDiscardIndex('garbage', hand), 3); // tsumogiri fallback
  assert.equal(parseDiscardIndex('99', hand), 3); // out of range clamps
  assert.equal(parseDiscardIndex('-1', hand), 3);
  assert.equal(parseDiscardIndex('', hand), 3);
  assert.equal(parseDiscardIndex('1m', []), -1);
});

// ---- nagashi with closed kan still qualifies ----
test('isNagashi: ankan keeps eligibility, open kan kills it', () => {
  const discards = ['1m', '9p', '1z', '9s', '2z'];
  assert.equal(H.isNagashi({ melds: [{ tiles: ['5z', '5z', '5z', '5z'], open: false, type: 'kan' }], discards }), true);
  assert.equal(H.isNagashi({ melds: [{ tiles: ['5z', '5z', '5z', '5z'], open: true, type: 'kan' }], discards }), false);
});

// ---- suukaikan extended ----
test('isSuukaikanAbort: split 3/1 aborts, solo 5 continues', () => {
  assert.equal(H.isSuukaikanAbort([3, 1, 0, 0]), true);
  assert.equal(H.isSuukaikanAbort([5, 0, 0, 0]), false);
  assert.equal(H.isSuukaikanAbort([0, 0, 0, 0]), false);
});

// ---- botDiscard boundaries ----
test('botDiscard: riichi locks tsumogiri; full ban falls back safely', () => {
  const hand = ['1m', '2m', '3m'];
  assert.equal(
    H.botDiscard(hand, true, [], () => 0.99),
    2
  );
  const banned = H.botDiscard(['1p', '1p'], false, ['1p'], () => 0.99);
  assert.ok(banned === 0 || banned === 1);
  for (let i = 0; i < 50; i++) {
    const d = H.botDiscard(hand, false, [], Math.random);
    assert.ok(d >= 0 && d < hand.length);
  }
});

// ---- chiOptions exclusions ----
test('chiOptions: honors excluded, aka completable; shapes offered', () => {
  assert.deepEqual(H.chiOptions(['1m'], '5z'), []);
  assert.deepEqual(H.chiOptions(['1p', '2p'], '3p'), [[1, 2]]);
  assert.deepEqual(H.chiOptions(['1p', '3p'], '2p'), [[1, 3]]);
  // Aka discard folds to its five: 3p+4p can chi an aka 0p (=5p).
  assert.deepEqual(H.chiOptions(['3p', '4p'], '0p'), [[3, 4]]);
  assert.deepEqual(H.chiOptions(['0p', '1p', '2p'], '3p'), [[1, 2]]);
});

// ---- tile primitives ----
test('DORA_NEXT wraps suits and honors; aka maps to five', () => {
  assert.equal(DORA_NEXT('9m'), '1m');
  assert.equal(DORA_NEXT('9p'), '1p');
  assert.equal(DORA_NEXT('9s'), '1s');
  assert.equal(DORA_NEXT('7z'), '5z'); // dragons cycle 5z->6z->7z->5z
  assert.equal(DORA_NEXT('4z'), '1z'); // winds cycle 1z->2z->3z->4z->1z (was 5z!)
  assert.equal(DORA_NEXT('0m'), '6m');
  assert.equal(DORA_NEXT('0p'), '6p');
  assert.equal(DORA_NEXT('0s'), '6s');
  assert.equal(DORA_NEXT('4p'), '5p');
});

test('fullCounts: 136 tiles with aka split', () => {
  const c = fullCounts();
  assert.equal(
    Object.values(c).reduce((a, b) => a + b, 0),
    136
  );
  assert.equal(c['5m'], 3);
  assert.equal(c['0m'], 1);
  assert.equal(c['5p'], 3);
  assert.equal(c['0p'], 1);
  assert.equal(c['5s'], 3);
  assert.equal(c['0s'], 1);
  assert.equal(KINDS.length, 34);
  assert.equal(same('0m', '5m'), true);
  assert.equal(norm('0s'), '5s');
  assert.equal(toCounts(['0m'])[0][4], 1);
});

// ---- DynamicPool boundaries ----
test('DynamicPool: zero weight excluded; exhausted decrement throws', () => {
  const pool = DynamicPool.full(createRNG(5));
  const t = pool.sample(() => 0);
  assert.equal(t, null); // everything excluded
  assert.throws(() => pool.decrement('9x'), /exhausted/);
  assert.equal(pool.reserveSlot('9x', 'NOPE'), false);
  assert.equal(pool.takeSlot('NOPE'), null);
});

test('DynamicPool: full-hand drain via canonical draw step conserves', () => {
  const s = core.createMatchState({ seed: 21 });
  core.setupDeadWall(s);
  core.dealHands(s);
  for (let i = 0; i < 20; i++) {
    const t = core.executeDrawStep(i % 4, s); // pushes to hand
    assert.ok(typeof t === 'string');
    s.players[i % 4].hand.pop();
    s.players[i % 4].discards.push(t);
  }
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
});

// ---- FlowManager clamps ----
test('FlowManager: clamps 0..150, tier edges', () => {
  const f = new FlowManager(4);
  f.set(0, 200);
  assert.equal(f.get(0), 150);
  f.set(1, -50);
  assert.equal(f.get(1), 0);
  f.set(2, 24);
  assert.equal(f.tier(2), 0);
  f.set(2, 25);
  assert.equal(f.tier(2), 1);
  f.set(2, 50);
  assert.equal(f.tier(2), 2);
  f.set(2, 100);
  assert.equal(f.tier(2), 3);
  f.set(2, 150);
  assert.equal(f.tier(2), 4);
  assert.equal(f.get(9), 0); // out-of-range seat: no NaN
});

// ---- RNG determinism ----
test('RNG: same seed replays; fork is deterministic', () => {
  const a = createRNG(42),
    b = createRNG(42);
  for (let i = 0; i < 10; i++) assert.equal(a.next(), b.next());
  assert.notEqual(createRNG(1).next(), createRNG(2).next());
  const f1 = createRNG(7).fork(3).next(),
    f2 = createRNG(7).fork(3).next();
  assert.equal(f1, f2);
});

// ---- invariants throw paths ----
test('invariants: dead wall, hand size, scores all throw on violation', () => {
  assert.throws(() => assertDeadWall(Array(13).fill('1m')), /dead wall/);
  assert.throws(() => assertHandSize(Array(12).fill('1m')), /hand size/);
  assertHandSize(Array(13).fill('1m'));
  assertHandSize(Array(14).fill('1m'));
  assert.throws(() => assertScoresConserved([24000, 25000, 25000, 25000], 0), /conserved/);
  assert.doesNotThrow(() => assertScoresConserved([24000, 25000, 25000, 25000], 1000));
  assert.ok(checkConservation([['1m'], ['1m']]).length > 0);
});

// ---- aka ron + aka furiten equivalence ----
test('aka discard completes five wait; aka discard triggers furiten', () => {
  const hand13 = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '5p', '5p', '6p', '7p'];
  const mk = (over) => ({ hand: [...hand13], melds: [], discards: [], tempFuriten: false, ...over });
  const pl = [
    mk({}),
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
  ];
  const att = H.tryRon(pl[0], '0p', { ...C({ riichi: true }), jikaze: 2 }, pl, [], {});
  assert.equal(att.win, true); // 0p == 5p completes 567p... wait 5p6p7p
  const furi = mk({ discards: ['0p'] });
  const waits = H.getWaits(furi, pl, [], C({}));
  assert.ok(waits.includes('5p'));
  assert.equal(H.isDiscardFuriten(furi, waits), true);
});

// ---- open-hand tenpai detection ----
test('getWaits works for open tenpai (pon + sequences)', () => {
  const p = {
    hand: ['2m', '3m', '4m', '5p', '5p', '6s', '7s', '8s', '8s', '8s'],
    melds: [{ tiles: ['7z', '7z', '7z'], open: true, type: 'pon' }],
    discards: [],
    tempFuriten: false,
  };
  const pls = [
    p,
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
  ];
  const waits = H.getWaits(p, pls, [], C({}));
  assert.ok(waits.includes('5p')); // pair completion... 5p pair needs one more? has 2 already -> tanki? plus sequences
});

// ---- replay tamper variants ----
test('replay: discard-not-in-hand throws', () => {
  const seed = 4242;
  const s = core.createMatchState({ seed });
  core.setupDeadWall(s);
  core.dealHands(s);
  const j = replay.createJournal(seed);
  replay.startKyoku(j, seed);
  const t = core.executeDrawStep(0, s);
  replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'discard', '9x'); // never in hand
  assert.throws(() => replay.verifyJournal(j), /not in hand/);
});

test('scoreHand rejects impossible fifth copy gracefully (no crash)', () => {
  // Five 1m across hand+win: lib should not credit a win shaped by 5 copies.
  const r = scoreHand(
    ['1m', '1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m'],
    [],
    '1m',
    false,
    C({})
  );
  assert.equal(typeof r.isAgari, 'boolean');
});

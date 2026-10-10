// yaku-map.test.js — coverage and correctness for the riichi-lib -> protocol
// `Kind` translation used to build `RoundWon.yaku_list`.
//
// This file had zero coverage: nothing in the repo asserted that a yaku the
// scoring library can actually emit survives translation. Two common yaku
// (Toitoi and Sanankou) were silently dropped, so a win reached the client with a
// yaku list missing its main yaku while `RoundWon.han` stayed correct.
//
// The two tests that matter:
//   1. every yaku the lib can emit is either mapped or explicitly unsupported
//   2. every `Kind` the map targets is a real protocol enum variant, recovered
//      from the vendored WASM client binary

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const YAKU_TABLE = require('riichi/yaku.js');
const {
  buildYakuList,
  rankFromResult,
  UNSUPPORTED_BY_PROTOCOL,
  LEGACY_ALIASES,
  JP_TO_KIND,
  ROUND_WIND_KIND,
  SEAT_WIND_KIND,
  DORA_LABELS,
} = require('../yaku-map');

// Japanese name -> protocol Kind, across all three yaku tables.
const JP_TO_KIND_ALL = { ...JP_TO_KIND, ...ROUND_WIND_KIND, ...SEAT_WIND_KIND };

// --------------------------------------------------------------- lib coverage

test('every yaku the riichi lib can emit is mapped or explicitly unsupported', () => {
  const missing = Object.keys(YAKU_TABLE).filter((n) => !(n in JP_TO_KIND_ALL) && !UNSUPPORTED_BY_PROTOCOL.has(n));
  assert.deepEqual(
    missing,
    [],
    `yaku the lib can emit but yaku-map does not handle: ${missing.join(', ')}. ` +
      'Map them to a protocol Kind, or add them to UNSUPPORTED_BY_PROTOCOL if the ' +
      'protocol has no such variant.'
  );
});

test('UNSUPPORTED_BY_PROTOCOL names really exist in the lib (no stale entries)', () => {
  for (const name of UNSUPPORTED_BY_PROTOCOL) {
    assert.ok(YAKU_TABLE[name], `${name} is listed as unsupported but the lib never emits it`);
  }
});

test('every mapped Japanese name is one the lib can emit, or a declared alias', () => {
  const dead = Object.keys(JP_TO_KIND_ALL).filter((n) => !YAKU_TABLE[n] && !LEGACY_ALIASES.has(n));
  assert.deepEqual(dead, [], `mapped but never emitted by the lib: ${dead.join(', ')}`);
});

test('LEGACY_ALIASES is not stale — entries must be mapped, and still unemitted', () => {
  for (const n of LEGACY_ALIASES) {
    assert.ok(n in JP_TO_KIND_ALL, `${n} is a declared alias but is not mapped`);
    assert.ok(!YAKU_TABLE[n], `${n} is a declared alias but the pinned lib now emits it`);
  }
});

test('dora labels cover every dora the lib can emit', () => {
  const r = buildYakuList({ yaku: { ドラ: '1飜', 赤ドラ: '1飜', 裏ドラ: '1飜' } });
  assert.deepEqual(r, [
    [{ Dora: 'Dora' }, 1],
    [{ Dora: 'RedDora' }, 1],
    [{ Dora: 'UraDora' }, 1],
  ]);
});

// ------------------------------------------------------------ specific yaku

test('Toitoi (対々和) maps to AllTriplets', () => {
  assert.equal(JP_TO_KIND['対々和'], 'AllTriplets');
  assert.deepEqual(buildYakuList({ yaku: { 対々和: '2飜' } }), [[{ Yaku: 'AllTriplets' }, 2]]);
});

test('Sanankou (三暗刻) maps to ThreeConcealedTriplets', () => {
  assert.equal(JP_TO_KIND['三暗刻'], 'ThreeConcealedTriplets');
  assert.deepEqual(buildYakuList({ yaku: { 三暗刻: '2飜' } }), [[{ Yaku: 'ThreeConcealedTriplets' }, 2]]);
});

test('a toitoi hand keeps every one of its yaku', () => {
  // The regression shape: the dropped yaku used to vanish while han stayed right.
  const r = buildYakuList({ yaku: { 役牌白: '1飜', 対々和: '2飜', ドラ: '1飜' } });
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map(([item]) => item.Yaku || item.Dora),
    ['ValueHonourWhiteDragon', 'AllTriplets', 'Dora']
  );
});

test('unsupported yaku are dropped without breaking the rest of the list', () => {
  assert.deepEqual(buildYakuList({ yaku: { 人和: '1飜', 立直: '1飜' } }), [[{ Yaku: 'Riichi' }, 1]]);
});

// -------------------------------------------------------------- enum validity

// The protocol's `Kind` enum, in binary order. Recovered from the vendored WASM
// client, where serde serialises unit variants as their Rust names.
const PROTOCOL_KINDS = [
  'Riichi',
  'DoubleRiichi',
  'Unbroken',
  'FullyConcealedHand',
  'SevenPairs',
  'Nagashi',
  'Mangan',
  'LastTileDraw',
  'LastTileClaim',
  'AfterAQuad',
  'RobbingAQuad',
  'Pinfu',
  'TwinSequences',
  'MixedSequences',
  'FullStraight',
  'DoubleTwinSequences',
  'AllTriplets',
  'ThreeConcealedTriplets',
  'MixedTriplets',
  'AllInside',
  'ValueHonourSeatWind',
  'ValueHonourRoundWind',
  'ValueHonourWhiteDragon',
  'ValueHonourGreenDragon',
  'ValueHonourRedDragon',
  'CommonEnds',
  'PerfectEnds',
  'CommonTerminals',
  'LittleDragons',
  'ThreeQuads',
  'CommonFlush',
  'PerfectFlush',
  'ThirteenOrphans',
  'ThirteenOrphansThirteenWait',
  'FourConcealedTriplets',
  'FourConcealedTripletsPairWait',
  'BigDragons',
  'LittleWinds',
  'BigWinds',
  'AllHonours',
  'PerfectTerminals',
  'AllGreen',
  'NineGates',
  'PureNineGates',
  'FourQuads',
  'BlessingOfHeaven',
  'BlessingOfEarth',
];

test('the protocol Kind list still matches the vendored WASM binary', (t) => {
  const wasmPath = path.join(__dirname, '..', 'public', 'mahjong-client.aa938046.wasm');
  if (!fs.existsSync(wasmPath)) {
    t.skip('vendored WASM client absent — cannot re-verify the protocol enum');
    return;
  }
  const bin = fs.readFileSync(wasmPath).toString('latin1');
  const anchor = bin.indexOf('RiichiDoubleRiichiUnbrokenFullyConcealedHandSevenPairs');
  assert.ok(anchor > 0, 'could not locate the Kind enum in the WASM binary');
  // Names are concatenated with no separators; walk them in order.
  const run = bin.slice(anchor, anchor + 1200);
  let cursor = 0;
  for (const k of PROTOCOL_KINDS) {
    const at = run.indexOf(k, cursor);
    assert.ok(at >= cursor, `${k} missing or out of order in the protocol Kind enum`);
    cursor = at + k.length;
  }
});

// The protocol's `DoraLabel` and `ScoreRank` enums, likewise recovered from the
// WASM binary. These are separate enums from `Kind` and must be validated
// against their own variant lists.
const PROTOCOL_DORA_LABELS = ['Dora', 'RedDora', 'UraDora', 'PeiDora'];
const PROTOCOL_RANKS = ['Normal', 'Mangan', 'Haneman', 'Baiman', 'Sanbaiman', 'Yakuman'];

test('the protocol DoraLabel/ScoreRank lists still match the WASM binary', (t) => {
  const wasmPath = path.join(__dirname, '..', 'public', 'mahjong-client.aa938046.wasm');
  if (!fs.existsSync(wasmPath)) {
    t.skip('vendored WASM client absent — cannot re-verify the protocol enums');
    return;
  }
  const bin = fs.readFileSync(wasmPath).toString('latin1');
  const anchor = bin.indexOf(PROTOCOL_DORA_LABELS.join(''));
  assert.ok(anchor > 0, 'could not locate DoraLabel in the WASM binary');
  const run = bin.slice(anchor, anchor + 200);
  assert.ok(run.startsWith(PROTOCOL_DORA_LABELS.join('')), 'DoraLabel run mismatch');
  assert.ok(run.includes(PROTOCOL_RANKS.join('')), 'ScoreRank run mismatch');
});

test('every Kind the map targets is a real protocol variant', () => {
  const known = new Set(PROTOCOL_KINDS);
  const bogusYaku = [...new Set(Object.values(JP_TO_KIND_ALL))].filter((k) => !known.has(k));
  assert.deepEqual(bogusYaku, [], `yaku-map targets non-existent Kind variants: ${bogusYaku.join(', ')}`);
});

test('every DoraLabel the map targets is a real DoraLabel variant', () => {
  const known = new Set(PROTOCOL_DORA_LABELS);
  const bogus = [...new Set(Object.values(DORA_LABELS))].filter((k) => !known.has(k));
  assert.deepEqual(bogus, [], `yaku-map targets non-existent DoraLabel variants: ${bogus.join(', ')}`);
});

test('rankFromResult only emits real ScoreRank variants', () => {
  const names = ['', '満貫', '跳満', '倍満', '三倍満', '数え役満', '役満', '2倍役満', 'ダブル役満', 'ドラ'];
  const known = new Set(PROTOCOL_RANKS);
  for (const name of names) {
    for (const yakuman of [0, 1, 2]) {
      const rank = rankFromResult({ name, yakuman });
      assert.ok(known.has(rank), `rank '${rank}' for name='${name}' yakuman=${yakuman} is not a ScoreRank`);
    }
  }
});

// ------------------------------------------------------------------- ranks

test('rankFromResult maps every limit-hall name the lib emits', () => {
  const cases = [
    ['満貫', 'Mangan'],
    ['跳満', 'Haneman'],
    ['倍満', 'Baiman'],
    ['三倍満', 'Sanbaiman'],
    ['数え役満', 'Yakuman'],
    ['役満', 'Yakuman'],
    ['2倍役満', 'Yakuman'],
    ['ダブル役満', 'Yakuman'],
    ['', 'Normal'],
    ['ドラ', 'Normal'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(rankFromResult({ name, yakuman: 0 }), expected, `name=${name}`);
  }
});

test('rankFromResult reports Yakuman whenever the lib flags yakuman', () => {
  for (const name of ['', '満貫', '2倍役満']) {
    assert.equal(rankFromResult({ name, yakuman: 1 }), 'Yakuman');
    assert.equal(rankFromResult({ name, yakuman: 2 }), 'Yakuman');
  }
});

// ------------------------------------------------------------------- shape

test('buildYakuList emits the [[ScoreItem, han], ...] shape the client expects', () => {
  const r = buildYakuList({
    yaku: { 立直: '1飜', 一発: '1飜', 裏ドラ: '1飜', 国士無双十三面待ち: 'ダブル役満' },
  });
  for (const entry of r) {
    assert.ok(Array.isArray(entry) && entry.length === 2, 'each entry is [ScoreItem, han]');
    const [item, han] = entry;
    assert.equal(typeof han, 'number');
    assert.ok(item.Yaku !== undefined || item.Dora !== undefined, 'ScoreItem is tagged Yaku or Dora');
    assert.equal(Object.keys(item).length, 1, 'ScoreItem has exactly one variant');
  }
  // Yakuman carry han 0; the rank carries the magnitude.
  assert.deepEqual(r[3], [{ Yaku: 'ThirteenOrphansThirteenWait' }, 0]);
});

test('buildYakuList tolerates missing or empty yaku', () => {
  assert.deepEqual(buildYakuList({}), []);
  assert.deepEqual(buildYakuList({ yaku: {} }), []);
});

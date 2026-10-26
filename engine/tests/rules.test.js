// rules.test.js — structured scoring/rules corpus (Fix plan Phase 3).
// Pins pinned-lib behavior (riichi 1.2.0, syanten 1.6.0) for standard yaku,
// fu boundaries, dora, win flags, ron gating, abort/round helpers, kuikae,
// ankan waits, nagashi, oka/uma — plus invariants, rules-config and replay.
// Yaku keys are the lib's Japanese names (see probes in git history).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreHand } = require('../scoring');
const H = require('../helpers');
const { RULES } = require('../rules-config');
const { checkConservation, assertDeadWall, assertScoresConserved } = require('../invariants');
const core = require('../core');
const replay = require('../replay');
const { fullCounts } = require('../tiles');

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
const has = (r, key) => r.yaku[key] !== undefined;

// ---- A. closed yaku ----
test('tanyao + menzen-tsumo: han 2, fu 30, ten 2000', () => {
  const r = scoreHand(
    ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '5p', '6p', '7p', '8s', '8s'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '断么九') && has(r, '門前清自摸和'));
  assert.equal(r.han, 2);
  assert.equal(r.fu, 30);
  assert.equal(r.ten, 2000);
});

test('yakuhai haku triplet + tsumo', () => {
  const r = scoreHand(
    ['5z', '5z', '5z', '2m', '3m', '4m', '6p', '7p', '8p', '2s', '3s', '4s', '9m', '9m'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '役牌白'));
  assert.equal(r.han, 2);
});

test('chiitoitsu: 7 pairs, flat 25 fu', () => {
  const r = scoreHand(
    ['1m', '1m', '2m', '2m', '3p', '3p', '4p', '4p', '5s', '5s', '6s', '6s', '7z', '7z'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '七対子'));
  assert.equal(r.fu, 25);
  assert.equal(r.ten, 3200);
});

test('kokushi musou: yakuman regardless of han 0', () => {
  const r = scoreHand(
    ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '1m'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '国士無双'));
  assert.ok(r.yakuman > 0);
  assert.equal(r.ten, 32000);
});

test('suuankou: yakuman 32000', () => {
  const r = scoreHand(
    ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '7z', '7z', '7z', '9m', '9m'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '四暗刻'));
  assert.equal(r.ten, 32000);
});

test('pinfu ron on ryanmen: pinfu + tanyao, fu 30', () => {
  const r = scoreHand(
    ['2m', '3m', '4m', '3p', '4p', '5p', '5p', '6p', '7p', '7s', '7s', '6s', '7s'],
    [],
    '5s',
    false,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '平和'));
  assert.equal(r.fu, 30);
  assert.equal(r.ten, 2000);
});

// ---- B. open hands ----
test('open tanyao ron: tanyao only, no tsumo yaku', () => {
  const r = scoreHand(
    ['2m', '3m', '4m', '5m', '6m', '7m', '5p', '7p', '8s', '8s'],
    [{ tiles: ['2p', '3p', '4p'], open: true, type: 'chi' }],
    '6p',
    false,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '断么九'));
  assert.ok(!has(r, '門前清自摸和'));
  assert.equal(r.han, 1);
  assert.equal(r.ten, 1000);
});

// ---- C. dora / aka ----
test('dora tiles add han (2 dora on tanyao-tsumo -> han 4)', () => {
  const hand = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '5p', '6p', '7p', '8s', '8s'];
  const base = scoreHand(hand, [], null, true, C({}));
  const withDora = scoreHand(hand, [], null, true, C({ dora: ['2m', '5p'] }));
  assert.equal(base.han, 2);
  assert.ok(has(withDora, 'ドラ'));
  assert.equal(withDora.han, base.han + 2);
});

test('aka five counts as dora (aka pair -> +1 han)', () => {
  const r = scoreHand(
    ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '5p', '6p', '7p', '0s', '5s'],
    [],
    null,
    true,
    C({})
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '赤ドラ'));
  assert.equal(r.han, 3);
  assert.equal(r.ten, 4000);
});

test('riichi tsumo with dora stack reaches haneman', () => {
  const r = scoreHand(
    ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p', '3p'],
    [],
    null,
    true,
    C({ riichi: true, dora: ['2p'] })
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '立直') && has(r, '一気通貫'));
  assert.equal(r.han, 7);
  assert.equal(r.ten, 12000);
});

// ---- D. win flags ----
test('rinshan flag yields rinshan yaku', () => {
  const r = scoreHand(
    ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '3p', '3p'],
    [{ tiles: ['7s', '7s', '7s', '7s'], open: false, type: 'kan' }],
    null,
    true,
    C({ kanFlag: true })
  );
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '嶺上開花'));
});

test('double riichi + ippatsu stack', () => {
  const hand14 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p', '3p'];
  const r = scoreHand(hand14, [], null, true, C({ doubleRiichi: true, ippatsu: true }));
  assert.equal(r.isAgari, true);
  assert.ok(has(r, 'ダブル立直') && has(r, '一発'));
});

test('chankan flag yields chankan yaku', () => {
  const hand13 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'];
  const r = scoreHand(hand13, [], '3p', false, C({ kanFlag: true }));
  assert.equal(r.isAgari, true);
  assert.ok(has(r, '槍槓') || has(r, '搶槓'));
});

test('haitei / houtei flags yield last-tile yaku', () => {
  const hand14 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p', '3p'];
  const hand13 = hand14.slice(0, 13);
  assert.ok(has(scoreHand(hand14, [], null, true, C({ lastFlag: true })), '海底摸月'));
  assert.ok(has(scoreHand(hand13, [], '3p', false, C({ lastFlag: true })), '河底撈魚'));
});

// ---- E. ron gating (incl. overtime shibari) ----
const PHAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'];
const plist = (p) => [
  p,
  { hand: [], melds: [], discards: [] },
  { hand: [], melds: [], discards: [] },
  { hand: [], melds: [], discards: [] },
];

test('no-yaku shape cannot ron (han gate)', () => {
  // Open chinitsu-ish shape with no yaku: sequences only, no tanyao/honitsu value.
  const p = {
    hand: ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p'],
    melds: [{ tiles: ['5p', '6p', '7p'], open: true, type: 'chi' }],
    discards: [],
    tempFuriten: false,
  };
  const att = H.tryRon(p, '4p', C({}), plist(p), []);
  assert.equal(att.win, false);
});

test('ryanhan-shibari blocks 1-han ron, yakuman passes', () => {
  // Open tanyao ron is exactly 1 han -> blocked under minHan 2.
  const p = {
    hand: ['2m', '3m', '4m', '5m', '6m', '7m', '5p', '7p', '8s', '8s'],
    melds: [{ tiles: ['2p', '3p', '4p'], open: true, type: 'chi' }],
    discards: [],
    tempFuriten: false,
  };
  const blocked = H.tryRon(p, '6p', C({}), plist(p), [], { minHan: 2 });
  assert.equal(blocked.win, false);
  const open = H.tryRon(p, '6p', C({}), plist(p), [], { minHan: 1 });
  assert.equal(open.win, true);
  const kokushi = {
    hand: ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'],
    melds: [],
    discards: [],
    tempFuriten: false,
  };
  const pass = H.tryRon(kokushi, '1m', C({}), plist(kokushi), [], { minHan: 2 });
  assert.equal(pass.win, true);
});

// ---- F. waits ----
test('waits find the pair completion; karaten still counts as tenpai', () => {
  const p = { hand: [...PHAND], melds: [], discards: [], tempFuriten: false };
  assert.ok(H.getWaits(p, plist(p), [], C({})).includes('3p'));
});

// ---- G. abort / round helpers ----
test('suufon-renda and suukaikan conditions', () => {
  assert.equal(H.isSuufonRenda(['1z', '1z', '1z', '1z']), true);
  assert.equal(H.isSuufonRenda(['1z', '1z', '1z', '2z']), false);
  assert.equal(H.isSuufonRenda(['5m', '5m', '5m', '5m']), false);
  assert.equal(H.isSuufonRenda(['1z', '1z', '1z']), false);
  assert.equal(H.isSuukaikanAbort([2, 1, 1, 0]), true);
  assert.equal(H.isSuukaikanAbort([4, 0, 0, 0]), false);
  assert.equal(H.isSuukaikanAbort([1, 1, 0, 0]), false);
});

test('round winds, riichi gate, yaochuu counting', () => {
  assert.equal(H.bakazeOf(0), 1);
  assert.equal(H.bakazeOf(3), 1);
  assert.equal(H.bakazeOf(4), 2);
  assert.equal(H.bakazeOf(7), 2);
  assert.equal(H.roundLabel(0), 'EAST 1');
  assert.equal(H.roundLabel(5), 'SOUTH 2');
  assert.equal(H.canRiichi(1000, 4), true);
  assert.equal(H.canRiichi(900, 10), false);
  assert.equal(H.canRiichi(2000, 3), false);
  assert.equal(H.countYaochuu(['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z']), 13);
  assert.equal(H.countYaochuu(PHAND), 2); // 1m, 9m
});

test('distinctYaochuu: kyuushu-kyuuhai counts kinds, not tiles', () => {
  // 九種九牌 is "nine KINDS". riichi.wiki: "9 different types of honor/terminal
  // tile". Nine tiles of three kinds is not a legal declaration — the gate in
  // game.js used to count tiles and let these through (KI-22).
  const thirteenOrphans = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
  assert.equal(H.distinctYaochuu(thirteenOrphans), 13);
  assert.equal(H.countYaochuu(thirteenOrphans), 13, 'tiles and kinds agree when all are distinct');

  // Nine yaochuu tiles, three kinds: illegal.
  assert.equal(H.countYaochuu(['1m', '1m', '1m', '1m', '1p', '1p', '1p', '9s', '9s']), 9);
  assert.equal(H.distinctYaochuu(['1m', '1m', '1m', '1m', '1p', '1p', '1p', '9s', '9s']), 3);

  // Exactly nine distinct is the boundary, and it is inclusive.
  const nine = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z'];
  assert.equal(H.distinctYaochuu(nine), 9);
  assert.equal(H.distinctYaochuu([...nine, '2m']), 9, 'a simple does not add a kind');

  // The aka 5 is a 5, not a terminal, so it must not count.
  assert.equal(H.distinctYaochuu(['0m', '0p', '0s']), 0, 'red 5s are not terminals');
  assert.equal(H.distinctYaochuu(['0m', '1m']), 1, '0m counts as the same kind as 1m');
});

// ---- H. kuikae bans ----
test('kuikae bans after chi', () => {
  assert.deepEqual(H.kuikaeBannedChi('2p', '3p'), ['1p', '4p']);
  assert.deepEqual(H.kuikaeBannedChi('1s', '3s'), ['2s']);
  assert.deepEqual(H.kuikaeBannedChi('8m', '9m'), ['7m']);
});

// ---- I. ankan-after-riichi wait preservation ----
test('ankan keeps tanki waits, breaks shanpon waits', () => {
  const seqs = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'];
  const wctx = { dora: [], bakaze: 1, jikaze: 1 };
  const lkKeep = [...seqs, '7p', '7p', '7p', '4p'];
  const plKeep = {
    hand: [...lkKeep, '7p'],
    melds: [],
    riichiWaits: H.getWaits({ hand: lkKeep, melds: [] }, [], [], wctx),
  };
  assert.deepEqual(plKeep.riichiWaits, ['4p']);
  assert.equal(H.ankanKeepsWaits(plKeep, '7p'), true);
  const lkBreak = [...seqs, '3p', '3p', '4p', '4p'];
  const plBreak = {
    hand: [...lkBreak, '3p'],
    melds: [],
    riichiWaits: H.getWaits({ hand: lkBreak, melds: [] }, [], [], wctx),
  };
  assert.equal(H.ankanKeepsWaits(plBreak, '3p'), false);
});

test('ankanKeepsWaits fails closed when the waits are unknown', () => {
  // `[]` is truthy, so a bare `!riichiWaits` guard let an unknown wait set
  // through and compared it against a computed one.
  const hand = ['1m', '1m', '1m', '1m', '2p', '2p', '4p', '5p', '6p', '7s', '8s', '9s', '5z', '5z'];
  assert.equal(H.ankanKeepsWaits({ hand, melds: [], riichiWaits: [] }, '1m'), false);
  assert.equal(H.ankanKeepsWaits({ hand, melds: [], riichiWaits: null }, '1m'), false);
  assert.equal(H.ankanKeepsWaits({ hand, melds: [], riichiWaits: undefined }, '1m'), false);
  // With the real waits the same hand is fine.
  const good = { hand, melds: [], riichiWaits: ['2p', '5z'] };
  assert.equal(H.ankanKeepsWaits(good, '1m'), true);
  // A kan tile that is not in the hand must also refuse rather than throw.
  assert.equal(H.ankanKeepsWaits(good, '9z'), false);
});

// ---- J. nagashi / oka-uma ----
test('nagashi: closed all-terminal discards only', () => {
  assert.equal(H.isNagashi({ melds: [], discards: ['1m', '9p', '1z', '9s', '2z'] }), true);
  assert.equal(
    H.isNagashi({ melds: [{ tiles: ['1m', '1m', '1m'], open: true, type: 'pon' }], discards: ['1m', '9p'] }),
    false
  );
  assert.equal(H.isNagashi({ melds: [], discards: ['1m', '5p'] }), false);
  assert.equal(H.isNagashi({ melds: [], discards: [] }), false);
});

test('oka/uma placement is zero-sum with tie averaging', () => {
  const t1 = H.applyOkaUma([31000, 26000, 24000, 19000]);
  assert.equal(t1.map((r) => r.total).join(','), '41,6,-16,-31');
  const t3 = H.applyOkaUma([30000, 30000, 20000, 20000]);
  assert.ok(t3[0].total === 25 && t3[3].total === -25);
});

// ---- K. invariants ----
test('fresh deal conserves 136; dead wall 14; scores conserved', () => {
  const s = core.createMatchState({ seed: 11 });
  core.setupDeadWall(s);
  assertDeadWall(s.deadWall);
  core.dealHands(s);
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
  assertScoresConserved([25000, 25000, 25000, 25000], 0);
  assertScoresConserved([24000, 25000, 25000, 26000], 0);
});

test('tampered partition is reported, not silent', () => {
  const s = core.createMatchState({ seed: 11 });
  core.setupDeadWall(s);
  core.dealHands(s);
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  parts[0] = [...parts[0], '1m']; // duplicate a tile
  assert.ok(checkConservation(parts).length > 0);
});

// ---- L. rules-config matches engine behavior ----
test('rules-config defaults mirror game.js constants', () => {
  assert.equal(RULES.startScore, 25000);
  assert.equal(RULES.riichiValue, 1000);
  assert.equal(RULES.minWallForRiichi, 4);
  assert.equal(RULES.honbaTsumo, 100);
  assert.equal(RULES.honbaRon, 300);
  assert.equal(RULES.deadWallLength, 14);
});

// ---- M. replay journal round-trips and verifies ----
test('replay: logged core draws verify; tampered draw throws', () => {
  const seed = 99;
  const j = replay.createJournal(seed);
  replay.startKyoku(j, seed);
  const s = core.createMatchState({ seed });
  core.setupDeadWall(s);
  core.dealHands(s);
  for (let i = 0; i < 8; i++) {
    const t = core.executeDrawStep(i % 4, s);
    replay.record(j, i % 4, 'draw', t);
    s.players[i % 4].hand.pop();
    replay.record(j, i % 4, 'discard', t);
    s.players[i % 4].discards.push(t);
  }
  const r = replay.verifyJournal(replay.fromJSON(replay.toJSON(j)));
  assert.equal(r.draws, 8);
  assert.equal(r.discards, 8);
  const bad = replay.fromJSON(replay.toJSON(j));
  bad.actions.push(['draw', 0, '9x']); // unknown tile: never live
  assert.throws(() => replay.verifyJournal(bad), /not live/);
});

// Find a seed whose pool still holds `need` copies of some kind after the deal,
// so call tests are not pinned to a brittle hand. Deterministic and cheap.
function seedWithTile(need) {
  for (let seed = 1; seed < 1000; seed++) {
    const s = core.createMatchState({ seed });
    core.setupDeadWall(s);
    core.dealHands(s);
    const t = Object.keys(s.pool.counts).find((k) => s.pool.counts[k] >= need);
    if (t) return { seed, t };
  }
  throw new Error(`no seed with ${need} live copies of a kind`);
}

function blankJournal(seed) {
  const j = replay.createJournal(seed);
  replay.startKyoku(j, seed);
  return j;
}

test('replay: a pon is reconstructed from the river and the hand', () => {
  const { seed, t } = seedWithTile(3);
  const j = blankJournal(seed);
  replay.record(j, 1, 'draw', t);
  replay.record(j, 1, 'discard', t); // river of seat 1 is now [t]
  replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'draw', t); // seat 0 holds two more copies
  replay.record(j, 0, 'call', { kind: 'pon', tiles: [t, t, t], from: 1, called: t });
  const r = replay.verifyJournal(j);
  assert.equal(r.calls, 1);
  assert.equal(r.draws, 3);
  assert.equal(r.discards, 1);
});

test('replay: a chi is reconstructed from a run', () => {
  const seed = 20240617;
  const s = core.createMatchState({ seed });
  core.setupDeadWall(s);
  core.dealHands(s);
  let run = null;
  for (const su of ['m', 'p', 's']) {
    for (let n = 1; n <= 7 && !run; n++) {
      const a = `${n}${su}`,
        b = `${n + 1}${su}`,
        c = `${n + 2}${su}`;
      if (s.pool.counts[a] >= 1 && s.pool.counts[b] >= 1 && s.pool.counts[c] >= 1) run = [a, b, c];
    }
    if (run) break;
  }
  assert.ok(run, 'this seed must still hold a live run');
  const [a, b, c] = run;
  const j = blankJournal(seed);
  replay.record(j, 1, 'draw', b);
  replay.record(j, 1, 'discard', b);
  replay.record(j, 0, 'draw', a);
  replay.record(j, 0, 'draw', c);
  replay.record(j, 0, 'call', { kind: 'chi', tiles: [a, b, c], from: 1, called: b });
  assert.equal(replay.verifyJournal(j).calls, 1);
});

test('replay: an ankan draws all four from hand', () => {
  const { seed, t } = seedWithTile(4);
  const j = blankJournal(seed);
  for (let i = 0; i < 4; i++) replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'call', { kind: 'ankan', tiles: [t, t, t, t] });
  const r = replay.verifyJournal(j);
  assert.equal(r.calls, 1);
  assert.equal(r.draws, 4);
});

test('replay: a kakan upgrades an existing pon', () => {
  const { seed, t } = seedWithTile(4);
  const j = blankJournal(seed);
  replay.record(j, 1, 'draw', t);
  replay.record(j, 1, 'discard', t);
  replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'call', { kind: 'pon', tiles: [t, t, t], from: 1, called: t });
  replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'call', { kind: 'kakan', tiles: [t, t, t, t] });
  const r = replay.verifyJournal(j);
  assert.equal(r.calls, 2);
  assert.equal(r.draws, 4);
});

test('replay: a daiminkan plus a rinshan replacement draw', () => {
  const { seed, t } = seedWithTile(4);
  const s = core.createMatchState({ seed });
  core.setupDeadWall(s);
  core.dealHands(s);
  const replacement = s.deadWall[0]; // a wanpai tile: not in the live pool
  const j = blankJournal(seed);
  replay.record(j, 1, 'draw', t);
  replay.record(j, 1, 'discard', t);
  for (let i = 0; i < 3; i++) replay.record(j, 0, 'draw', t);
  replay.record(j, 0, 'call', { kind: 'daiminkan', tiles: [t, t, t, t], from: 1, called: t });
  replay.record(j, 0, 'rinshan', replacement);
  const r = replay.verifyJournal(j);
  assert.equal(r.calls, 1);
  assert.equal(r.draws, 5); // seat 1's draw + 3 for the kan + the rinshan
});

test('replay: a wanpai swap moves a live tile into a rinshan slot', () => {
  const { seed } = seedWithTile(1);
  const s = core.createMatchState({ seed });
  core.setupDeadWall(s);
  core.dealHands(s);
  const displaced = s.deadWall[0];
  const live = Object.keys(s.pool.counts).find((k) => k !== displaced);
  assert.ok(live, 'need a live tile that is not the displaced wanpai tile');
  const exhausted = Object.keys(fullCounts()).find((k) => !s.pool.counts[k]);
  assert.ok(exhausted, 'need a kind with no live copies for the negative case');

  const j = blankJournal(seed);
  replay.record(j, null, 'swap', { slot: 0, tile: live });
  replay.record(j, 0, 'rinshan', live);
  const r = replay.verifyJournal(j);
  assert.equal(r.draws, 1);

  // Swapping in a tile the pool does not hold is not a legal swap.
  const bad = blankJournal(seed);
  replay.record(bad, null, 'swap', { slot: 0, tile: exhausted });
  assert.throws(() => replay.verifyJournal(bad), new RegExp(`swap-in ${exhausted} not live`));
});

test('replay: a call that could not have happened throws', () => {
  const { seed, t } = seedWithTile(4);

  // The called tile is not the discarder's last discard (seat 2 has not discarded).
  {
    const j = blankJournal(seed);
    replay.record(j, 1, 'draw', t);
    replay.record(j, 1, 'discard', t);
    replay.record(j, 0, 'draw', t);
    replay.record(j, 0, 'draw', t);
    replay.record(j, 0, 'call', { kind: 'pon', tiles: [t, t, t], from: 2, called: t });
    assert.throws(() => replay.verifyJournal(j), /last discard/);
  }
  // A meld tile that was never in hand.
  {
    const j = blankJournal(seed);
    replay.record(j, 0, 'call', { kind: 'ankan', tiles: [t, t, t, t] });
    assert.throws(() => replay.verifyJournal(j), /not in hand/);
  }
  // A kakan with no pon to promote.
  {
    const j = blankJournal(seed);
    replay.record(j, 0, 'draw', t);
    replay.record(j, 0, 'call', { kind: 'kakan', tiles: [t, t, t, t] });
    assert.throws(() => replay.verifyJournal(j), /no pon meld/);
  }
  // A rinshan tile that is not in the wanpai (here: a live-pool tile).
  {
    const j = blankJournal(seed);
    replay.record(j, 0, 'rinshan', t);
    assert.throws(() => replay.verifyJournal(j), /not wanpai slot 0/);
  }
  // An unknown kind and a malformed payload.
  {
    const j = blankJournal(seed);
    replay.record(j, 0, 'call', { kind: 'nope', tiles: [t, t, t] });
    assert.throws(() => replay.verifyJournal(j), /unknown call kind/);
  }
  {
    const j = blankJournal(seed);
    replay.record(j, 0, 'call', { kind: 'pon' });
    assert.throws(() => replay.verifyJournal(j), /malformed call/);
  }
});

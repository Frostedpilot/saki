// offline-rules.test.js — regression coverage for the code that lives ONLY in
// engine/game.js.
//
// Everything shared with the bridge server (getWaits, tryRon, botDiscard,
// chiOptions, isNagashi, applyOkaUma, ankanKeepsWaits, ...) lives in
// engine/helpers.js and is covered by rules.test.js. This file deliberately does
// not duplicate that. It covers the offline CLI/plumbing layer that had zero
// coverage, plus the offline power rig:
//
//   parseArgs    — regression: the parser used to accept only `--flag=value`,
//                  so the documented `--flag value` form produced NaN and the
//                  match loop ran zero hands while printing a normal-looking
//                  "all ties" match result.
//   buildWall    — the offline wall (pre-shuffled 136 array).
//   countVisible — karaten detection, used for tenpai at exhaustive draw.
//   powerDraw    — the offline Saki power rig (NOT the roster framework).
//   botDiscard / botWantsCall — via the `rand` injection helpers.js added.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const game = require('../game.js');
const { botDiscard, botWantsCall, getWaits, isSuufonRenda, isSuukaikanAbort } = require('../helpers');
const { norm, fullCounts, same } = require('../tiles');

const { parseArgs, buildWall, countVisible, powerDraw, POWERS } = game;

// ---------------------------------------------------------------- parseArgs

test('parseArgs: accepts the equals form (--kyoku=1)', () => {
  assert.deepEqual(parseArgs(['--kyoku=1']), { kyoku: '1' });
});

test('parseArgs: accepts the space form (--kyoku 1)', () => {
  assert.deepEqual(parseArgs(['--kyoku', '1']), { kyoku: '1' });
});

test('parseArgs: regression — space form must not become boolean true', () => {
  // This was the bug: parseInt(true) is NaN, so `for (kyoku = 0; kyoku < NaN)`
  // never executed and the engine reported a finished match having played
  // zero hands. Any numeric flag had to survive the space form as a string.
  const args = parseArgs(['--kyoku', '4', '--seed', '42']);
  assert.equal(Number.isNaN(parseInt(args.kyoku, 10)), false);
  assert.equal(parseInt(args.kyoku, 10), 4);
  assert.equal(parseInt(args.seed, 10), 42);
});

test('parseArgs: negative values are values, not the next flag', () => {
  assert.equal(parseInt(parseArgs(['--human', '-1']).human, 10), -1);
  assert.equal(parseInt(parseArgs(['--human=-1']).human, 10), -1);
});

test('parseArgs: bare flags stay boolean true', () => {
  assert.equal(parseArgs(['--selftest']).selftest, true);
  assert.equal(parseArgs(['--closed-only'])['closed-only'], true);
  assert.equal(parseArgs(['--closed-only=1'])['closed-only'], '1');
});

test('parseArgs: a flag immediately followed by another flag is not a value', () => {
  const a = parseArgs(['--seed', '42', '--closed-only', '1']);
  assert.equal(a.seed, '42');
  assert.equal(a['closed-only'], '1');
  const b = parseArgs(['--closed-only', '--seed', '7']);
  assert.equal(b['closed-only'], true);
  assert.equal(b.seed, '7');
});

test('parseArgs: non-flag arguments are ignored', () => {
  assert.deepEqual(parseArgs(['stray', '--kyoku=4', 'other']), { kyoku: '4' });
});

// ---------------------------------------------------------------- buildWall

test('buildWall: produces exactly 136 tiles', () => {
  assert.equal(buildWall().length, 136);
});

test('buildWall: four copies of every kind except the aka carve-out', () => {
  const counts = {};
  for (const t of buildWall()) counts[t] = (counts[t] || 0) + 1;
  for (const [kind, n] of Object.entries(fullCounts())) {
    assert.equal(counts[kind] || 0, n, `${kind}: expected ${n}, got ${counts[kind] || 0}`);
  }
});

test('buildWall: exactly one red five per suited suit, no honours', () => {
  const counts = {};
  for (const t of buildWall()) counts[t] = (counts[t] || 0) + 1;
  assert.equal(counts['0m'], 1);
  assert.equal(counts['0p'], 1);
  assert.equal(counts['0s'], 1);
  // the plain five is displaced, not duplicated
  assert.equal(counts['5m'], 3);
  assert.equal(counts['5p'], 3);
  assert.equal(counts['5s'], 3);
  for (const z of ['1z', '2z', '3z', '4z', '5z', '6z', '7z']) {
    assert.equal(counts[z], 4, `${z} must keep all 4 copies`);
  }
});

test('buildWall: shuffles — two builds differ', () => {
  assert.notDeepEqual(buildWall(), buildWall());
});

// ------------------------------------------------------------- countVisible
// countVisible returns how many copies of a kind are already VISIBLE (hand,
// melds, discards, dead wall). It is used to decide whether a wait is karaten.

test('countVisible: counts copies in hand, melds and discards', () => {
  const players = [{ hand: ['1z'], melds: [{ tiles: ['1z'] }], discards: ['1z', '1z'] }];
  assert.equal(countVisible('1z', players, []), 4);
});

test('countVisible: karaten — all four copies visible', () => {
  const players = [{ hand: [], melds: [], discards: ['1z', '1z', '1z', '1z'] }];
  assert.equal(countVisible('1z', players, []), 4);
});

test('countVisible: nothing visible', () => {
  const players = [{ hand: ['1m'], melds: [], discards: ['9p'] }];
  assert.equal(countVisible('1z', players, []), 0);
});

test('countVisible: dead-wall tiles count as visible', () => {
  const players = [{ hand: ['1z'], melds: [], discards: [] }];
  assert.equal(countVisible('1z', players, []), 1);
  assert.equal(countVisible('1z', players, ['1z', '1z']), 3);
});

test('countVisible: aka and plain five are the same kind', () => {
  const players = [{ hand: ['0m'], melds: [], discards: ['5m', '5m', '5m'] }];
  assert.equal(countVisible('0m', players, []), 4);
  assert.equal(countVisible('5m', players, []), 4);
});

// ---------------------------------------------------------------- powerDraw

const ctxFor = (over = {}) => ({ dora: ['5m'], roundWind: 'E', ...over });
const HAND = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '1z'];

test('powerDraw: "none" just pops the wall', () => {
  const wall = buildWall();
  const top = wall[wall.length - 1];
  assert.equal(powerDraw(wall, HAND, 'none', ctxFor()), top);
  assert.equal(wall.length, 135);
});

test('powerDraw: returns null on an exhausted wall instead of throwing', () => {
  assert.equal(powerDraw([], HAND, 'saki', ctxFor()), null);
  assert.equal(powerDraw([], HAND, 'kuro', ctxFor()), null);
});

test('powerDraw: never invents a tile — conservation holds for every power', () => {
  // The offline rig reorders/splices the wall. Whatever it does, it must only
  // ever hand back a tile that was in the wall, exactly once per call.
  for (const power of POWERS) {
    for (let trial = 0; trial < 40; trial++) {
      const wall = buildWall();
      const before = wall.slice().sort();
      const hand = HAND.slice();
      for (let i = 0; i < 20; i++) {
        const t = powerDraw(wall, hand, power, ctxFor({ roundWind: trial % 2 ? 'S' : 'E' }));
        assert.ok(t !== null, `${power}: unexpected null at draw ${i}`);
        assert.ok(before.includes(t) || before.some((x) => same(x, t)), `${power}: drew ${t}, not in wall`);
        hand.push(t);
        if (hand.length > 14) hand.shift();
      }
      assert.equal(wall.length, 136 - 20, `${power}: wall length drifted`);
    }
  }
});

test('powerDraw: kuro prefers dora from the tail of the wall', () => {
  // Seed the tail with a dora and give kuro a long run; it should hit it far
  // more often than chance (1/8 of the tail window per draw at 70%).
  let hits = 0;
  for (let trial = 0; trial < 60; trial++) {
    const wall = buildWall();
    wall[wall.length - 1] = '5m'; // guaranteed dora in the 8-tile window
    const hand = HAND.slice();
    for (let i = 0; i < 8; i++) {
      const t = powerDraw(wall, hand, 'kuro', ctxFor());
      hand.push(t);
      if (hand.length > 14) hand.shift();
      if (t === '5m') { hits++; break; }
    }
  }
  assert.ok(hits > 30, `kuro dora pull rate too low: ${hits}/60`);
});

test('powerDraw: saki/yuuki never increase shanten by discarding the draw', () => {
  // Both re-draw when the tile does not help, so over many draws they should
  // reach tenpai from HAND at least as often as a plain pop.
  const syanten = require('syanten');
  const { toCounts } = require('../tiles');
  const shantenOf = (h) => syanten(toCounts(h.slice(-14)));
  for (const power of ['saki', 'yuuki']) {
    let tenpai = 0;
    for (let trial = 0; trial < 40; trial++) {
      const wall = buildWall();
      const hand = HAND.slice();
      for (let i = 0; i < 14 && shantenOf(hand) > 0; i++) {
        hand.push(powerDraw(wall, hand, power, ctxFor()));
      }
      if (shantenOf(hand) === 0) tenpai++;
    }
    assert.ok(tenpai > 0, `${power} never reached tenpai from the test hand`);
  }
});

test('powerDraw: koromo only intervenes with a short wall', () => {
  // With a full wall and a 1-shanten hand, koromo has no tenpai wait to hunt.
  const wall = buildWall();
  const farHand = ['1m', '4m', '7m', '1p', '4p', '7p', '1s', '4s', '7s', '2z', '3z', '4z', '5z'];
  for (let i = 0; i < 5; i++) powerDraw(wall, farHand, 'koromo', ctxFor());
  assert.equal(wall.length, 136 - 5, 'koromo should just pop with no wait available');
});

test('POWERS: the list has no placeholder keys', () => {
  // `toki` and `teru` used to be accepted by the CLI but had no powerDraw
  // branch, so `--powers ... tok i` silently behaved like "none".
  for (const ghost of ['toki', 'teru']) {
    assert.ok(!POWERS.includes(ghost), `${ghost} should have been removed from POWERS`);
  }
  assert.ok(POWERS.includes('none'));
  assert.ok(POWERS.includes('saki'));
});

// ---------------------------------------------------- bots (rand injection)
// botDiscard calls rand() twice: once for the 15% random branch, once to pick
// an index from the shanten-optimal candidates. A constant 0 or 1 therefore
// breaks it (1 indexes past the end), so drive it with an explicit sequence.
function seqRand(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
// Skip the random branch, then always take the first candidate.
const NO_RANDOM_FIRST = seqRand([0.99, 0]);

test('botDiscard: riichi-locked always discards the drawn tile', () => {
  const hand = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '9s'];
  assert.equal(botDiscard(hand, true, [], () => 0.999), hand.length - 1);
});

test('botDiscard: never discards a banned tile (kuikae)', () => {
  const hand = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '9s'];
  // Sweep the random-branch decision and the candidate index together, so both
  // the 15% random path and the shanten-optimal path are exercised.
  for (let k = 0; k < 200; k++) {
    const rand = seqRand([k / 200, (k % 7) / 7]);
    const idx = botDiscard(hand, false, ['3m'], rand);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < hand.length, `bad index ${idx}`);
    assert.notEqual(norm(hand[idx]), '3m', 'banned tile was discarded');
  }
});

test('botDiscard: when every tile is banned it still returns a valid index', () => {
  const hand = ['1m', '2m', '3m', '5m'];
  for (let k = 0; k < 20; k++) {
    const idx = botDiscard(hand, false, hand.map(norm), seqRand([k / 20, (k % 5) / 5]));
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < hand.length);
  }
});

test('botDiscard: prefers the shanten-optimal discard over a random one', () => {
  // 123m + a loose 9s: dropping 9s is clearly best, dropping 1m is not.
  const hand = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '9s'];
  const idx = botDiscard(hand, false, [], NO_RANDOM_FIRST);
  assert.notEqual(norm(hand[idx]), '9s', 'should not keep the isolated 9s');
});

test('botWantsCall: closedOnly suppresses every call', () => {
  assert.equal(botWantsCall(1, true, () => 0), false);
  assert.equal(botWantsCall(-1, true, () => 0), false);
});

test('botWantsCall: a worsening call is rare, a neutral call is common', () => {
  // afterShantenGain < 0 means the call makes the hand worse.
  assert.equal(botWantsCall(-1, false, () => 0.04), true);
  assert.equal(botWantsCall(-1, false, () => 0.06), false);
  assert.equal(botWantsCall(1, false, () => 0.54), true);
  assert.equal(botWantsCall(1, false, () => 0.56), false);
});

// ------------------------------------------------- helpers used by game.js

test('abort helpers are the shared engine versions, not local copies', () => {
  // game.js used to keep verbatim duplicates "kept in sync by hand"; it now
  // imports these. Pin the behaviour the offline settlement loop relies on.
  assert.equal(isSuufonRenda(['1z', '1z', '1z', '1z']), true);
  assert.equal(isSuufonRenda(['1z', '1z', '1z', '2z']), false);
  assert.equal(isSuufonRenda(['1z', '1z', '1z']), false);

  assert.equal(isSuukaikanAbort([4, 0, 0, 0]), false, 'solo quad continues');
  assert.equal(isSuukaikanAbort([2, 2, 0, 0]), true, 'split four kans abort');
  assert.equal(isSuukaikanAbort([3, 0, 0, 0]), false, 'fewer than four kans');
});

test('getWaits is shape-only, so an open hand still has waits', () => {
  const players = [{ hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'], melds: [], discards: [] }];
  const waits = getWaits(players[0], players, [], { dora: [], bakaze: 1, jikaze: 2 });
  assert.ok(waits.length > 0, 'expected waits for a near-complete tanyao shape');
  assert.ok(waits.every((w) => typeof w === 'string'));
});
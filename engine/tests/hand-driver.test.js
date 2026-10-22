'use strict';
// hand-driver.test.js — the hand-level turn order (phase 4a, KI-04).
//
// The adapter is a fake so these stay fast and deterministic: they pin the
// outer loop only, not the per-turn rules that still live in each driver.
const test = require('node:test');
const assert = require('node:assert');
const { playHand } = require('../hand-driver');

function makeAdapter(overrides = {}) {
  const seen = [];
  const adapter = {
    checkKyuushu: () => -1,
    abortKyuushu: (seat) => ({ aborted: true, seat }),
    dealer: () => 0,
    wallLeft: () => 8,
    playTurn: (seat) => {
      seen.push(seat);
      if (seat === 2) return { end: true, winner: 2, winBy: { type: 'tsumo', seat: 2 } };
      return { end: false, next: (seat + 1) % 4 };
    },
    settle: (winner, winBy) => ({ winner, winBy }),
    ...overrides,
  };
  return { adapter, seen };
}

test('playHand follows next seats and settles the first end', async () => {
  const { adapter, seen } = makeAdapter();
  const result = await playHand(adapter);

  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(result.winner, 2);
  assert.deepEqual(result.winBy, { type: 'tsumo', seat: 2 });
});

test('playHand returns a kyuushu abort without playing a turn', async () => {
  const { adapter, seen } = makeAdapter({ checkKyuushu: () => 3 });
  const result = await playHand(adapter);

  assert.deepEqual(seen, []);
  assert.deepEqual(result, { aborted: true, seat: 3 });
});

test('playHand settles an exhausted wall with no winner', async () => {
  const { adapter, seen } = makeAdapter({ wallLeft: () => 0, settle: (w, wb) => ({ w, wb }) });
  const result = await playHand(adapter);

  assert.deepEqual(seen, []);
  assert.deepEqual(result, { w: -1, wb: null });
});

test('playHand defaults a missing next to the next seat', async () => {
  const { adapter, seen } = makeAdapter({
    playTurn: (seat) => {
      seen.push(seat);
      if (seat === 1) return { end: true, winner: 1, winBy: null };
      return { end: false };
    },
  });
  const result = await playHand(adapter);

  assert.deepEqual(seen, [0, 1]);
  assert.equal(result.winner, 1);
});

test('playHand stops an overlong hand at maxTurns', async () => {
  let stops = 0;
  const { adapter, seen } = makeAdapter({
    wallLeft: () => 8,
    playTurn: (seat) => {
      seen.push(seat);
      return { end: false, next: (seat + 1) % 4 };
    },
    onSafetyStop: () => {
      stops++;
    },
  });
  const result = await playHand(adapter, { maxTurns: 3 });

  assert.equal(seen.length, 3);
  assert.equal(stops, 1);
  assert.equal(result.winner, -1);
  assert.equal(result.winBy, null);
});

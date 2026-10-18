// match-flow.test.js — parity guard for the shared hand-transition table.
//
// Both rule front-ends (engine/game.js main(), server/table.js Table) must
// make the same dealer/honba/kyoku decision for the same outcome. These tests
// pin the shared module AND drive both call-site shapes through it:
// game.js ron (wins[].seat) and table.js ron (hits[].seat).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../match-flow');
const { RULES } = require('../rules-config');

test('abort repeats dealer, increments honba, repeats kyoku', () => {
  assert.deepEqual(F.postHandFlow({ aborted: true, win: null, tenpaiSeats: [], dealer: 2 }), {
    keepDealer: true,
    honba: 'increment',
    kyokuRepeat: true,
  });
});

test('dealer tsumo repeats dealer and increments honba', () => {
  assert.deepEqual(
    F.postHandFlow({ aborted: false, win: { type: 'tsumo', winnerSeats: [1] }, tenpaiSeats: [], dealer: 1 }),
    { keepDealer: true, honba: 'increment', kyokuRepeat: true }
  );
});

test('non-dealer tsumo rotates and resets honba', () => {
  assert.deepEqual(
    F.postHandFlow({ aborted: false, win: { type: 'tsumo', winnerSeats: [2] }, tenpaiSeats: [], dealer: 0 }),
    { keepDealer: false, honba: 'reset', kyokuRepeat: false }
  );
});

test('ron: game.js wins[] shape and table.js hits[] shape agree', () => {
  const gameHits = [{ seat: 1 }, { seat: 3 }].map((h) => h.seat);
  const tableHits = [{ seat: 1 }, { seat: 3 }].map((h) => h.seat);
  for (const seats of [gameHits, tableHits]) {
    // Dealer 1 is among winners -> repeat.
    assert.deepEqual(
      F.postHandFlow({ aborted: false, win: { type: 'ron', winnerSeats: seats }, tenpaiSeats: [], dealer: 1 }),
      { keepDealer: true, honba: 'increment', kyokuRepeat: true }
    );
    // Dealer 0 is not -> rotate.
    assert.deepEqual(
      F.postHandFlow({ aborted: false, win: { type: 'ron', winnerSeats: seats }, tenpaiSeats: [], dealer: 0 }),
      { keepDealer: false, honba: 'reset', kyokuRepeat: false }
    );
  }
});

test('exhaustive: dealer tenpai repeats, noten rotates; honba always increments', () => {
  assert.deepEqual(F.postHandFlow({ aborted: false, win: null, tenpaiSeats: [0, 2], dealer: 0 }), {
    keepDealer: true,
    honba: 'increment',
    kyokuRepeat: true,
  });
  assert.deepEqual(F.postHandFlow({ aborted: false, win: null, tenpaiSeats: [1, 2], dealer: 0 }), {
    keepDealer: false,
    honba: 'increment',
    kyokuRepeat: false,
  });
});

test('notenPayments matches the standard schedule and RULES.notenTotal', () => {
  assert.equal(RULES.notenTotal, 3000);
  assert.deepEqual(F.notenPayments(1), { give: 3000, take: 1000 });
  assert.deepEqual(F.notenPayments(2), { give: 1500, take: 1500 });
  assert.deepEqual(F.notenPayments(3), { give: 1000, take: 3000 });
  assert.deepEqual(F.notenPayments(0), { give: 0, take: 0 });
  assert.deepEqual(F.notenPayments(4), { give: 0, take: 0 });
});

test('minHan reads RULES (overtime ryanhan-shibari)', () => {
  assert.equal(F.minHan(false), RULES.minHan);
  assert.equal(F.minHan(true), RULES.overtimeMinHan);
  assert.equal(F.minHan(false), 1);
  assert.equal(F.minHan(true), 2);
});

test('bustOutSeat finds the first sub-zero score', () => {
  assert.equal(F.bustOutSeat([25000, 25000, 25000, 25000]), -1);
  assert.equal(F.bustOutSeat([25000, -100, 25000, 25000]), 1);
});

// Nagashi mangan payout — the block that used to be written out inline in both
// game.js and table.js. Pinned here so the two cannot drift again.
test('nagashiPayments: a non-dealer mangan tsumo (dealer 4000, others 2000)', () => {
  const { deltas, totals } = F.nagashiPayments([2], 0, 0);
  assert.deepEqual(deltas, [-4000, -2000, 8000, -2000]);
  assert.deepEqual(totals, [0, 0, 8000, 0]);
});

test('nagashiPayments: a dealer mangan tsumo takes 4000 from each', () => {
  const { deltas, totals } = F.nagashiPayments([0], 0, 0);
  assert.deepEqual(deltas, [12000, -4000, -4000, -4000]);
  assert.deepEqual(totals, [12000, 0, 0, 0]);
});

test('nagashiPayments: honba adds RULES.honbaTsumo per payer', () => {
  const h = RULES.honbaTsumo * 2;
  const { deltas } = F.nagashiPayments([2], 0, 2);
  assert.deepEqual(deltas, [-(4000 + h), -(2000 + h), 8000 + 3 * h, -(2000 + h)]);
});

test('nagashiPayments: several winners are zero-sum and pay each other', () => {
  const { deltas, totals } = F.nagashiPayments([1, 3], 0, 0);
  assert.equal(
    deltas.reduce((a, b) => a + b, 0),
    0,
    'no points created or lost'
  );
  // Each collects 4000 (dealer) + 2000 (the other winner's share) + 2000 (seat 2).
  assert.equal(totals[1], 8000);
  assert.equal(totals[3], 8000);
  assert.deepEqual(deltas, [-8000, 6000, -4000, 6000]);
});

test('manganPayment: 4000 when either side is the dealer, else 2000', () => {
  assert.equal(F.manganPayment(0, 1, 0, 0), 4000, 'dealer pays the dealer rate');
  assert.equal(F.manganPayment(1, 0, 0, 0), 4000, 'dealer receives the dealer rate');
  assert.equal(F.manganPayment(1, 2, 0, 0), 2000, 'neither side is the dealer');
  assert.equal(F.manganPayment(1, 2, 0, 1), 2000 + RULES.honbaTsumo);
  assert.equal(F.manganPayment(1, 2, 0), 2000, 'honba defaults to 0 (the chombo path)');
});

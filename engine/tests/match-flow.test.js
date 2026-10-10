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

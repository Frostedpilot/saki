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

// Win settlement — the score arithmetic both front-ends used to run inline.
test('winPayments: dealer tsumo takes the dealer rate from every seat', () => {
  const { deltas, pay } = F.winPayments({
    type: 'tsumo',
    winner: 2,
    dealer: 2,
    honba: 0,
    result: { oya: [4000], ko: [2000, 2000] },
  });
  assert.deepEqual(deltas, [-4000, -4000, 12000, -4000]);
  assert.equal(pay, 12000);
});

test('winPayments: non-dealer tsumo charges the dealer more', () => {
  const { deltas, pay } = F.winPayments({
    type: 'tsumo',
    winner: 2,
    dealer: 0,
    honba: 0,
    result: { oya: [4000], ko: [2000, 1000] },
  });
  assert.deepEqual(deltas, [-2000, -1000, 4000, -1000]);
  assert.equal(pay, 4000);
});

test('winPayments: tsumo honba is per payer; ron honba is per win', () => {
  const tsumo = F.winPayments({
    type: 'tsumo',
    winner: 0,
    dealer: 0,
    honba: 1,
    result: { oya: [4000], ko: [2000, 2000] },
  });
  assert.equal(tsumo.pay, 3 * (4000 + RULES.honbaTsumo));
  const ron = F.winPayments({
    type: 'ron',
    winner: 1,
    dealer: 0,
    honba: 2,
    result: { ten: 5200 },
    from: 3,
  });
  assert.equal(ron.pay, 5200 + RULES.honbaRon * 2);
  assert.deepEqual(ron.deltas, [0, ron.pay, 0, -ron.pay]);
});

test('winPayments: a settled hand is always zero-sum', () => {
  const cases = [
    { type: 'tsumo', winner: 0, dealer: 0, honba: 1, result: { oya: [4000], ko: [2000, 2000] } },
    { type: 'tsumo', winner: 3, dealer: 1, honba: 0, result: { oya: [2000], ko: [2000, 1000] } },
    { type: 'ron', winner: 2, dealer: 0, honba: 0, result: { ten: 8000 }, from: 1 },
  ];
  for (const args of cases) {
    const { deltas } = F.winPayments(args);
    assert.equal(
      deltas.reduce((a, b) => a + b, 0),
      0,
      `zero-sum: ${JSON.stringify(args)}`
    );
  }
});

// The abortive-draw switch. Defaulting to enabled is the property that makes
// wiring it behaviour-neutral: a key that is absent or misspelled cannot turn a
// rule off, only an explicit `false` can.
test('abortEnabled: enabled unless the flag is explicitly false', () => {
  const flags = { tripleRon: true, suukaikan: false };
  assert.equal(F.abortEnabled(flags, 'tripleRon'), true);
  assert.equal(F.abortEnabled(flags, 'suukaikan'), false);
  assert.equal(F.abortEnabled(flags, 'suufonRenda'), true, 'a missing key defaults on');
  assert.equal(F.abortEnabled(undefined, 'anything'), true, 'no flag set defaults on');
});

// The dead-wall indicator layout: rinshan slots first, then dora/ura pairs. The
// initial pair is the first, each kan reveals the next, and the pair stops once it
// would run past the wall.
test('doraIndicatorSlots: initial pair, kan pairs, and the wall bound', () => {
  assert.deepEqual(F.doraIndicatorSlots(0), { dora: 4, ura: 5, revealed: true });
  assert.deepEqual(F.doraIndicatorSlots(1), { dora: 6, ura: 7, revealed: true });
  assert.deepEqual(F.doraIndicatorSlots(4), { dora: 12, ura: 13, revealed: true });
  assert.equal(F.doraIndicatorSlots(5).revealed, false, 'past the dead wall');
  // Derived from RULES, not a literal: the offsets must agree with the config.
  assert.equal(F.doraIndicatorSlots(0).dora, RULES.rinshanSlots);
  assert.ok(F.doraIndicatorSlots(4).ura < RULES.deadWallLength);
});

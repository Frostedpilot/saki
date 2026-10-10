const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RNG, createRNG } = require('../rng');

test('same seed -> identical sequence', () => {
  const a = createRNG(123),
    b = createRNG(123);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  const a = createRNG(1),
    b = createRNG(2);
  const sa = Array.from({ length: 10 }, () => a.next());
  const sb = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(sa, sb);
});

test('int(n) stays in range', () => {
  const r = createRNG(7);
  for (let i = 0; i < 200; i++) {
    const v = r.int(4);
    assert.ok(v >= 0 && v < 4);
  }
});

test('fork is deterministic per salt', () => {
  const r = createRNG(99);
  const f1 = r.fork(5),
    f2 = r.fork(5),
    f3 = r.fork(6);
  assert.equal(f1.next(), f2.next());
  assert.notEqual(f1.next(), f3.next());
});

test('seed 0 is valid and deterministic', () => {
  const a = createRNG(0),
    b = createRNG(0);
  assert.equal(a.next(), b.next());
});

test('unseeded RNG exposes interface without throwing', () => {
  const r = createRNG();
  const v = r.next();
  assert.ok(v >= 0 && v < 1);
  assert.ok(r.int(10) >= 0);
});

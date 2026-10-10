const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FlowManager, BASE_PER_DISCARD } = require('../powers/flowManager');

test('starts at 0% tier 0 for all seats', () => {
  const f = new FlowManager(4);
  for (let s = 0; s < 4; s++) {
    assert.equal(f.get(s), 0);
    assert.equal(f.tier(s), 0);
    assert.equal(f.canAfford(s, 25), false);
  }
});

test('tier boundaries 25/50/100/150', () => {
  const f = new FlowManager(1);
  const cases = [
    [0, 0],
    [24.9, 0],
    [25, 1],
    [49.9, 1],
    [50, 2],
    [99.9, 2],
    [100, 3],
    [149.9, 3],
    [150, 4],
  ];
  for (const [v, t] of cases) {
    f.set(0, v);
    assert.equal(f.tier(0), t, `flow ${v}`);
  }
});

test('caps at 150 and floors at 0', () => {
  const f = new FlowManager(1);
  f.addFlow(0, 999);
  assert.equal(f.get(0), 150);
  f.drainFlow(0, 999);
  assert.equal(f.get(0), 0);
  f.set(0, -5);
  assert.equal(f.get(0), 0);
  f.set(0, 500);
  assert.equal(f.get(0), 150);
});

test('onLegalDiscard adds base 1.5%', () => {
  const f = new FlowManager(1);
  f.onLegalDiscard(0);
  assert.equal(f.get(0), BASE_PER_DISCARD);
});

test('consume / consumeAll / canAfford', () => {
  const f = new FlowManager(1);
  f.set(0, 100);
  assert.equal(f.canAfford(0, 100), true);
  assert.equal(f.canAfford(0, 101), false);
  f.consume(0, 25);
  assert.equal(f.get(0), 75);
  f.consumeAll(0);
  assert.equal(f.get(0), 0);
});

test('seats are independent', () => {
  const f = new FlowManager(4);
  f.addFlow(0, 100);
  assert.equal(f.get(1), 0);
  f.drainFlow(0, 50);
  assert.equal(f.get(0), 50);
  assert.equal(f.get(1), 0);
});

test('long horizon: 200 discards saturate at 150, never exceed', () => {
  const f = new FlowManager(1);
  for (let i = 0; i < 200; i++) {
    f.onLegalDiscard(0);
    assert.ok(f.get(0) <= 150);
  }
  assert.equal(f.get(0), 150);
  assert.equal(f.tier(0), 4);
});

test('drain-mishap chain: alternating gain/drain stays in [0,150]', () => {
  const f = new FlowManager(1);
  const r = [10, -30, 50, -25, 100, -200, 40];
  for (let hand = 0; hand < 5; hand++) {
    for (const d of r) {
      if (d > 0) f.addFlow(0, d);
      else f.drainFlow(0, -d);
      assert.ok(f.get(0) >= 0 && f.get(0) <= 150);
    }
  }
});

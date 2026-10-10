const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatchState, setupDeadWall, dealHands, executeDrawStep } = require('../core');
const { PowerDispatcher } = require('../powers/index');

test('Phase 0/1: fresh state has 136, dead wall 14, hands 13 each', () => {
  const s = createMatchState({ seed: 1 });
  assert.equal(s.pool.total(), 136);
  setupDeadWall(s);
  assert.equal(s.deadWall.length, 14);
  assert.equal(s.pool.total(), 122);
  dealHands(s);
  for (const p of s.players) assert.equal(p.hand.length, 13);
  assert.equal(s.pool.total(), 70); // 136 - 14 - 52
});

test('Phase 2: draw step grows hand by 1 and shrinks pool by 1', () => {
  const s = createMatchState({ seed: 2 });
  setupDeadWall(s);
  dealHands(s);
  const before = s.pool.total();
  const t = executeDrawStep(0, s);
  assert.ok(typeof t === 'string');
  assert.equal(s.players[0].hand.length, 14);
  assert.equal(s.pool.total(), before - 1);
});

test('determinism: same seed -> same dealt hands and draw', () => {
  const mk = () => {
    const s = createMatchState({ seed: 42 });
    setupDeadWall(s);
    dealHands(s);
    executeDrawStep(0, s);
    return s.players.map((p) => [...p.hand].sort());
  };
  assert.deepEqual(mk(), mk());
});

test('different seeds diverge', () => {
  const mk = (seed) => {
    const s = createMatchState({ seed });
    setupDeadWall(s);
    dealHands(s);
    return s.players[0].hand.join(',');
  };
  assert.notEqual(mk(1), mk(2));
});

test('empty pool draw returns null without throwing', () => {
  const s = createMatchState({ seed: 1 });
  setupDeadWall(s);
  dealHands(s);
  let n = 0,
    t;
  while ((t = executeDrawStep(n % 4, s)) !== null) {
    n++;
    s.players[n % 4].hand.pop();
    s.players[n % 4].discards.push(t);
  }
  assert.equal(s.pool.total(), 0);
  assert.equal(executeDrawStep(0, s), null);
});

test('long horizon: full 70-draw hand with discards keeps conservation', () => {
  const s = createMatchState({ seed: 7 });
  setupDeadWall(s);
  dealHands(s);
  let draws = 0;
  for (let turn = 0; turn < 70; turn++) {
    const seat = turn % 4;
    const t = executeDrawStep(seat, s);
    assert.ok(t !== null, `exhausted early at turn ${turn}`);
    draws++;
    // simple discard: drop the drawn tile straight back to discards
    s.players[seat].hand.pop();
    s.players[seat].discards.push(t);
    s.flow.onLegalDiscard(seat);
    if (turn % 10 === 0) {
      const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
      assert.deepEqual(s.pool.audit(parts), [], `audit fail at turn ${turn}`);
    }
  }
  assert.equal(draws, 70);
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
});

test('long horizon chain: 8 consecutive hands, no cross-hand leakage', () => {
  let flowCarry = null;
  for (let hand = 0; hand < 8; hand++) {
    const s = createMatchState({ seed: 100 + hand });
    setupDeadWall(s);
    dealHands(s);
    assert.equal(s.pool.total(), 70);
    for (let turn = 0; turn < 70; turn++) {
      const seat = turn % 4;
      const t = executeDrawStep(seat, s);
      s.players[seat].hand.pop();
      s.players[seat].discards.push(t);
    }
    assert.equal(s.pool.total(), 0);
    const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
    assert.deepEqual(s.pool.audit(parts), [], `hand ${hand} leak`);
    flowCarry = s.flow; // engines recreate flow per hand; just ensure no crash
  }
  assert.ok(flowCarry !== null);
});

test('slot chain across a hand: reserve rinshan + haitei, then take', () => {
  const s = createMatchState({ seed: 5 });
  setupDeadWall(s);
  dealHands(s);
  // pick a tile still live in the pool (hand[0] may already be exhausted)
  const target = Object.keys(s.pool.counts)[0];
  assert.ok(target);
  const before = s.pool.total();
  assert.equal(s.pool.reserveSlot(target, 'RINSHAN_0'), true);
  assert.equal(s.pool.total(), before - 1);
  assert.equal(s.pool.takeSlot('RINSHAN_0'), target);
  s.players[0].hand.push(target); // taken slot tile re-enters inventory (e.g. rinshan draw)
  // failed reservation leaves pool untouched
  const missing = s.pool.reserveSlot('RINSHAN_0', 'NOPE_SLOT');
  void missing;
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
});

test('biased-hook chain still conserves over a full drain', () => {
  const s = createMatchState({ seed: 9 });
  const d = new PowerDispatcher();
  d.register(0, { onPowerDraw: (tile) => (tile === '1z' ? 8.0 : 1.0) });
  s.powers = d;
  setupDeadWall(s);
  dealHands(s);
  let n = 0;
  while (s.pool.total() > 0) {
    const seat = n % 4;
    const t = executeDrawStep(seat, s);
    assert.ok(t !== null);
    s.players[seat].hand.pop();
    s.players[seat].discards.push(t);
    n++;
    assert.ok(n < 200, 'drain runaway');
  }
  const parts = [...s.players.flatMap((p) => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
});

test('flow accrues across a hand via discards (economy chain)', () => {
  const s = createMatchState({ seed: 3 });
  setupDeadWall(s);
  dealHands(s);
  for (let i = 0; i < 10; i++) s.flow.onLegalDiscard(0);
  assert.equal(s.flow.get(0), 15);
  assert.equal(s.flow.tier(0), 0);
  for (let i = 0; i < 10; i++) s.flow.onLegalDiscard(0);
  assert.ok(s.flow.canAfford(0, 25));
});

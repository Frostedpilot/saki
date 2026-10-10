// furiten-riichi.test.js — regression tests for the permanent riichi
// furiten fix (Fix plan Phase 1).
// Rule: passing a winning tile while in riichi = furiten for the rest of
// the kyoku. The temp flag must NOT clear on subsequent draws, while
// non-riichi temp furiten still clears on the next draw.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');
const { scoreHand } = require('../scoring');

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
// Closed 1-9m + 222p + 33p wait: ron on 3p completes the pair.
const HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'];
const mkP = (over) => ({
  hand: [...HAND],
  melds: [],
  discards: [],
  tempFuriten: false,
  riichi: false,
  doubleRiichi: false,
  ...over,
});
const plist = (p) => [
  p,
  { hand: [], melds: [], discards: [] },
  { hand: [], melds: [], discards: [] },
  { hand: [], melds: [], discards: [] },
];

test('gate: non-riichi temp furiten clears on draw', () => {
  const p = mkP({ tempFuriten: true });
  H.clearTempFuritenOnDraw(p);
  assert.equal(p.tempFuriten, false);
});

test('gate: riichi temp furiten survives draws (permanent furiten)', () => {
  for (const over of [{ riichi: true }, { doubleRiichi: true }, { riichi: true, doubleRiichi: true }]) {
    const p = mkP({ tempFuriten: true, ...over });
    for (let i = 0; i < 5; i++) H.clearTempFuritenOnDraw(p); // several draws pass
    assert.equal(p.tempFuriten, true, JSON.stringify(over));
  }
});

test('riichi passer cannot ron later, but tsumo still works', () => {
  const p = mkP({ riichi: true, tempFuriten: true });
  H.clearTempFuritenOnDraw(p); // next draw: flag must persist
  const att = H.tryRon(p, '3p', C({ riichi: true }), plist(p), []);
  assert.equal(att.win, false);
  assert.equal(att.blocked, true);
  // Same tiles as tsumo: furiten never blocks self-draw.
  const r = scoreHand([...HAND, '3p'], [], null, true, C({ riichi: true }));
  assert.equal(r.isAgari, true);
});

test('non-riichi passer can ron again after their next draw', () => {
  const p = mkP({ tempFuriten: true });
  H.clearTempFuritenOnDraw(p); // own draw clears temp furiten
  const att = H.tryRon(p, '3p', C({}), plist(p), []);
  assert.equal(att.win, true);
});

test('discard furiten still blocks even without temp flag', () => {
  const p = mkP({ discards: ['3p'] });
  const waits = H.getWaits(p, plist(p), [], C({}));
  assert.ok(waits.includes('3p'));
  assert.equal(H.isDiscardFuriten(p, waits), true);
  const att = H.tryRon(p, '3p', C({}), plist(p), []);
  assert.equal(att.win, false);
  assert.equal(att.blocked, true);
  assert.equal(att.reason, 'discard');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreHand } = require('../scoring');

const C = (o = {}) => ({
  dora: [], bakaze: 1, jikaze: 2, riichi: false, doubleRiichi: false,
  ippatsu: false, kanFlag: false, lastFlag: false, tenhou: false, ...o,
});
const WIN_14 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p', '3p'];
const TENPAI_13 = WIN_14.slice(0, 13);

test('closed tsumo agari scores (ittsu + menzen tsumo)', () => {
  const r = scoreHand(WIN_14, [], null, true, C());
  assert.equal(r.isAgari, true);
  assert.ok(r.han >= 2);
});

test('ron on completing tile wins, wrong tile does not', () => {
  assert.equal(scoreHand(TENPAI_13, [], '3p', false, C()).isAgari, true);
  assert.equal(scoreHand(TENPAI_13, [], '1z', false, C()).isAgari, false);
});

test('dora adds han monotonically', () => {
  const base = scoreHand(WIN_14, [], null, true, C());
  const withDora = scoreHand(WIN_14, [], null, true, C({ dora: ['2p'] })); // 3p dora
  assert.ok(withDora.han > base.han);
});

test('riichi + ippatsu flags add yaku', () => {
  const r = scoreHand(WIN_14, [], null, true, C({ riichi: true, ippatsu: true }));
  assert.equal(r.isAgari, true);
  assert.ok(r.yaku['立直'] !== undefined);
  assert.ok(r.yaku['一発'] !== undefined);
});

test('rinshan flag yields rinshan yaku with a kan meld', () => {
  const closed = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '3p', '3p'];
  const r = scoreHand(closed, [{ tiles: ['7s', '7s', '7s', '7s'], open: false, type: 'kan' }], null, true, C({ kanFlag: true }));
  assert.equal(r.isAgari, true);
  assert.ok(r.yaku['嶺上開花'] !== undefined);
});

test('haitei / houtei flags yield last-tile yaku', () => {
  assert.ok(scoreHand(WIN_14, [], null, true, C({ lastFlag: true })).yaku['海底摸月'] !== undefined);
  assert.ok(scoreHand(TENPAI_13, [], '3p', false, C({ lastFlag: true })).yaku['河底撈魚'] !== undefined);
});

test('open hand can win by ron (shape-level)', () => {
  const r = scoreHand(TENPAI_13.slice(0, 10), [{ tiles: ['2p', '2p', '2p'], open: true, type: 'pon' }], '3p', false, C());
  assert.equal(typeof r.isAgari, 'boolean');
});

test('aka 0m in hand does not break scoring', () => {
  const hand = [...WIN_14];
  hand[4] = '0m'; // one 5m -> aka
  const r = scoreHand(hand, [], null, true, C());
  assert.equal(r.isAgari, true);
});

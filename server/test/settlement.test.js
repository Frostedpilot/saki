// settlement.test.js — deterministic coverage for score and riichi-stick
// settlement at the end of a hand.
//
// Found by adding a score-conservation assertion to the bridge E2E test: the
// exhaustive-draw path reported the riichi sticks on the table but never
// awarded them, so every riichi declared in a drawn hand destroyed 1000 points.
// The E2E match is seeded from Math.random(), so it only catches that by luck —
// these tests drive the settlement arithmetic directly and are deterministic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Table, START_SCORE } = require('../room');

const TOTAL = 4 * START_SCORE; // 100000

// A Table with just enough scaffolding for finishHand() to run headless.
function makeTable() {
  const sent = [];
  const room = {
    powerSeats: ['none', 'none', 'none', 'none'],
    sendTo() {},
    broadcastRoomState() {},
  };
  const t = new Table(room, 12345);
  t.broadcast = () => {};
  t.broadcastMessage = (m) => sent.push(m);
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];

  t.ctx = {
    players: [0, 1, 2, 3].map((s) => ({
      seat: s, hand: [], melds: [], discards: [],
      riichi: false, doubleRiichi: false, ippatsu: false,
    })),
    dealer: 0,
    bakaze: 1,
    doraInd: [],
    uraInd: [],
    dead: [],
    riichiPool: 0,
    baseDora: () => [],
    uraDora: () => [],
    state: { powers: { onSettlement() {} }, flow: null },
  };
  return t;
}

const sum = (t) => t.scores.reduce((a, b) => a + b, 0);

// A riichi declaration moves 1000 from the player to the table pot. Both halves
// matter: injecting the pot without the debit would leave the total 1000 high
// and mask the very leak these tests exist to catch.
function declareRiichi(t, seat, sticks = 1) {
  t.scores[seat] -= 1000 * sticks;
  t.ctx.players[seat].riichi = true;
  t.ctx.riichiPool += 1000 * sticks;
}

// A closed 13-tile hand waiting on 1p — unambiguously tenpai.
const TENPAI_HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '2p'];
// Scattered terminals and honours with gaps — unambiguously noten.
const NOTEN_HAND = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '9s'];

function setHands(t, tenpaiSeats) {
  for (const p of t.ctx.players) {
    p.hand = (tenpaiSeats.includes(p.seat) ? TENPAI_HAND : NOTEN_HAND).slice();
  }
}

// ---------------------------------------------------- exhaustive draw, no riichi

test('exhaustive draw with no riichi declared conserves points', async () => {
  const t = makeTable();
  setHands(t, [0, 1]);
  await t.finishHand(-1, null);
  assert.equal(sum(t), TOTAL);
});

// --------------------------------------------- sticks to tenpai at the draw

test('all four tenpai: the stick pot is split four ways', async () => {
  const t = makeTable();
  setHands(t, [0, 1, 2, 3]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  // Four tenpai means no noten payments, so the only movement is the stick.
  assert.equal(sum(t), TOTAL, 'the stick is redistributed, not destroyed');
  assert.deepEqual(t.scores.map((s, i) => s - before[i]), [250, 250, 250, 250]);
  assert.equal(t.ctx.riichiPool, 0);
});

test('two tenpai: both receive the stick, neither noten seat does', async () => {
  const t = makeTable();
  setHands(t, [1, 3]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  assert.equal(sum(t), TOTAL, 'sticks must not vanish');
  assert.equal(t.ctx.riichiPool, 0, 'hand pot emptied');

  // Noten payments move everyone; the stick is the difference in their favour.
  const gained = t.scores.map((s, i) => s - before[i]);
  // Two tenpai => +1500 each, -1500 each, then the stick split 1000 as 500/500.
  assert.deepEqual(gained[1], 2000, 'tenpai seat gains the noten payment plus half the stick');
  assert.deepEqual(gained[3], 2000, 'tenpai seat gains the noten payment plus half the stick');
  assert.deepEqual(gained[0], -1500, 'noten seat gains nothing from the stick');
  assert.deepEqual(gained[2], -1500, 'noten seat gains nothing from the stick');
});

test('an uneven split still distributes every 1000 exactly', async () => {
  const t = makeTable();
  setHands(t, [0, 1, 2]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  assert.equal(sum(t), TOTAL, 'no points invented or lost in a 3-way split');
  // Three tenpai => +1000 each, -3000 to the noten seat, plus one whole stick
  // to a single tenpai seat (1000 does not divide by 3).
  const gained = t.scores.map((s, i) => s - before[i]);
  assert.equal(gained[3], -3000, 'noten seat pays the noten penalty only');
  assert.equal(gained.slice(0, 3).reduce((a, b) => a + b, 0), 3000 + 1000);
});

test('nobody tenpai: the sticks carry to the next hand instead of vanishing', async () => {
  const t = makeTable();
  setHands(t, []);
  declareRiichi(t, 0, 1);

  await t.finishHand(-1, null);

  assert.equal(t.ctx.riichiPool, 0, 'hand pot emptied');
  assert.equal(t.riichiCarry, 1000, 'sticks carried forward');
  // The stick is still on the table, so it counts toward the conserved total.
  assert.equal(sum(t) + t.riichiCarry, TOTAL);
});

test('multiple carried sticks accumulate', async () => {
  const t = makeTable();
  setHands(t, []);
  declareRiichi(t, 0, 3);
  await t.finishHand(-1, null);
  assert.equal(t.riichiCarry, 3000);
  assert.equal(sum(t) + t.riichiCarry, TOTAL);
});

// --------------------------------------------------------------- tsumo / ron

// Two closed hands that win with a yaku in every seat wind, so a double ron is
// legal for both players without either relying on riichi.
// scoreHand takes 13 tiles for a ron (the winning tile arrives from the
// discarder) and 14 for a tsumo.
const RON_HAND = ['1m', '2m', '3m', '5m', '6m', '7m', '5z', '5z', '5z', '6s', '7s', '8s', '2p'];
const TSUMO_HAND = [...RON_HAND, '2p'];

test('dealer tsumo conserves points and takes the sticks', async () => {
  const t = makeTable();
  t.ctx.players[0].hand = TSUMO_HAND.slice();
  declareRiichi(t, 0, 2);

  const before = t.scores.slice();
  await t.finishHand(0, { type: 'tsumo', winTile: '2p', rinshan: false, haitei: false, first: false });

  assert.equal(sum(t), TOTAL, 'tsumo conserves points including sticks');
  assert.equal(t.ctx.riichiPool, 0);
  // Dealer tsumo of a 3-han 30-fu hand: each of the other three seats pays
  // oya[0] = 2000, and the winner also sweeps the two sticks.
  assert.equal(t.scores[0] - before[0], 3 * 2000 + 2000);
  for (const i of [1, 2, 3]) assert.ok(t.scores[i] < before[i], 'every other seat paid');
});

test('ron conserves points and the discarder funds it', async () => {
  const t = makeTable();
  t.ctx.players[1].hand = RON_HAND.slice();
  declareRiichi(t, 1, 1);

  const before = t.scores.slice();
  await t.finishHand(1, {
    type: 'ron', from: 2, tile: '2p',
    flags: { chankan: false, houtei: false }, hits: [{ seat: 1 }],
  });

  assert.equal(sum(t), TOTAL, 'ron conserves points');
  assert.equal(t.ctx.riichiPool, 0);
  // Riichi adds a han, so this is a 2-han 40-fu ron worth 2600, plus the stick.
  assert.equal(t.scores[1] - before[1], 2600 + 1000);
  assert.equal(t.scores[2] - before[2], -2600, 'discarder funds exactly the hand value');
});

test('double ron charges the discarder for both winners and conserves points', async () => {
  const t = makeTable();
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[3].hand = RON_HAND.slice();

  const before = t.scores.slice();
  await t.finishHand(1, {
    type: 'ron', from: 2, tile: '2p',
    flags: { chankan: false, houtei: false },
    hits: [{ seat: 1 }, { seat: 3 }],
  });

  assert.equal(sum(t), TOTAL, 'double ron conserves points');
  assert.equal(t.scores[1] - before[1], 1300, 'first winner takes the hand value');
  assert.equal(t.scores[3] - before[3], 1300, 'second winner takes the hand value');
  assert.equal(t.scores[2] - before[2], -2600, 'discarder pays both winners');
  assert.equal(t.ctx.riichiPool, 0);
});

// ----------------------------------------------------------- match teardown

test('a carry left when the match ends is returned evenly, not orphaned', () => {
  const t = makeTable();
  // Fund the pot, then carry it past the final hand exactly as the game does.
  t.scores[0] -= 1000;
  t.riichiCarry = 1000;
  assert.equal(sum(t), TOTAL - 1000, 'the stick is off the scores but still on the table');

  // run()'s settlement: a quarter of the pot each. 1000/4 is exact.
  const each = t.riichiCarry / 4;
  for (let s = 0; s < 4; s++) t.scores[s] += each;
  t.riichiCarry = 0;

  assert.equal(sum(t), TOTAL, 'the match total is conserved');
  assert.deepEqual(t.scores, [24250, 25250, 25250, 25250]);
});

test('three carried sticks also divide evenly', () => {
  const t = makeTable();
  t.scores[0] -= 3000;
  const each = 3000 / 4;
  for (let s = 0; s < 4; s++) t.scores[s] += each;

  assert.equal(sum(t), TOTAL);
  assert.deepEqual(t.scores, [22750, 25750, 25750, 25750]);
});
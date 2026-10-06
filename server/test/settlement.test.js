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

const { Table, START_SCORE } = require('../table');

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

// -------------------------------------------------- sticks at an exhaustive draw
//
// An exhaustive draw does NOT award the riichi pot to the tenpai players. The sticks
// stay on the table and are claimed by the next player to win a hand. Three tests in
// this file previously asserted the opposite (that the pot was split between tenpai
// seats), which was wrong and disagreed with engine/game.js — see docs/known-issues.md
// KI-19. What matters for conservation either way is that the pot is not destroyed:
// it moves from ctx.riichiPool to Table.riichiCarry.

test('all four tenpai: the pot carries, and no noten payments happen', async () => {
  const t = makeTable();
  setHands(t, [0, 1, 2, 3]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  assert.deepEqual(t.scores, before, 'four tenpai means no payments of any kind');
  assert.equal(t.riichiCarry, 1000, 'the stick stays on the table');
  assert.equal(sum(t) + t.riichiCarry, TOTAL, 'the stick is on the table, not destroyed');
});

test('two tenpai: the noten penalty is paid but the pot still carries', async () => {
  const t = makeTable();
  setHands(t, [1, 3]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  // Two tenpai => +1500 each, -1500 each. The stick is not part of this.
  const gained = t.scores.map((s, i) => s - before[i]);
  assert.deepEqual(gained, [-1500, 1500, -1500, 1500]);
  assert.equal(t.riichiCarry, 1000, 'the stick still carries — tenpai does not collect it');
  assert.equal(t.ctx.riichiPool, 0, 'the hand pot is emptied');
  assert.equal(sum(t) + t.riichiCarry, TOTAL);
});

test('an uneven tenpai split does not touch the pot', async () => {
  const t = makeTable();
  setHands(t, [0, 1, 2]);
  declareRiichi(t, 0, 1);

  const before = t.scores.slice();
  await t.finishHand(-1, null);

  // Three tenpai => +1000 each, -3000 from the noten seat.
  const gained = t.scores.map((s, i) => s - before[i]);
  assert.deepEqual(gained, [1000, 1000, 1000, -3000]);
  assert.equal(t.riichiCarry, 1000);
  assert.equal(sum(t) + t.riichiCarry, TOTAL);
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

test('the pot is carried regardless of how many are tenpai', async () => {
  // The rule is unconditional, so sweep every tenpai count through it.
  for (const seats of [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]]) {
    const t = makeTable();
    setHands(t, seats);
    declareRiichi(t, 0, 1);
    await t.finishHand(-1, null);
    assert.equal(t.riichiCarry, 1000,
      `tenpai [${seats}] must not change who holds the stick`);
    assert.equal(sum(t) + t.riichiCarry, TOTAL, `tenpai [${seats}]: conservation`);
  }
});

test('a later hand can still win the carried sticks', async () => {
  // The carried pot must be collectable, or carrying it would be a stalling bug.
  const t = makeTable();
  setHands(t, []);
  declareRiichi(t, 0, 2);
  await t.finishHand(-1, null);
  assert.equal(t.riichiCarry, 2000);

  t.ctx.players[0].hand = TSUMO_HAND.slice();
  t.ctx.dealer = 0;
  // Stand in for the next hand's setup, which does `riichiPool: this.riichiCarry`
  // (table.js) before clearing the Table's copy. Calling finishHand directly skips
  // that, so without this the win would find an empty table.
  t.ctx.riichiPool = t.riichiCarry;
  t.riichiCarry = 0;

  const before = t.scores.slice();
  await t.finishHand(0, { type: 'tsumo', winTile: '2p', rinshan: false, haitei: false, first: false });

  assert.equal(t.ctx.riichiPool, 0, 'the winner swept the table');
  assert.equal(t.riichiCarry, 0, 'nothing left to carry');
  // The two carried sticks went to the winner, on top of the tsumo payments.
  assert.equal(sum(t), TOTAL, 'the carried sticks were paid out, not duplicated');
  assert.ok(t.scores[0] - before[0] > 0, 'the winner gained');
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

// --------------------------------------------------------- triple ron (sanchahou)

test('triple ron is an abortive draw, not a three-way win', async () => {
  // Three players claiming the same discard voids the hand. Before KI-20 this paid
  // all three in full, which was also a KI-04 divergence: engine/game.js has always
  // aborted here.
  const t = makeTable();
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[2].hand = RON_HAND.slice();
  t.ctx.players[3].hand = RON_HAND.slice();
  declareRiichi(t, 0, 2);

  const before = t.scores.slice();
  const outcome = await t.finishHand(1, {
    type: 'ron', from: 0, tile: '2p',
    flags: { chankan: false, houtei: false },
    hits: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
  });

  assert.deepEqual(t.scores, before, 'nobody is paid on an abortive draw');
  assert.equal(sum(t) + t.riichiCarry, TOTAL, 'the pot is on the table, not destroyed');
  assert.equal(t.riichiCarry, 2000, 'riichi sticks carry to the next hand');
  assert.equal(t.ctx.riichiPool, 0, 'the hand pot is emptied');
  assert.ok(outcome && outcome.aborted, 'the caller must be told the hand was aborted');
});

test('triple ron broadcasts a draw, never a win', async () => {
  const t = makeTable();
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[2].hand = RON_HAND.slice();
  t.ctx.players[3].hand = RON_HAND.slice();

  const sent = [];
  t.broadcast = (m) => sent.push(m);
  await t.finishHand(1, {
    type: 'ron', from: 0, tile: '2p',
    flags: { chankan: false, houtei: false },
    hits: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
  });

  assert.equal(sent.filter((m) => m.RoundWon).length, 0, 'no winner may be announced');
  const draws = sent.filter((m) => m.RoundDraw);
  assert.equal(draws.length, 1, 'the client needs exactly one draw event');
  assert.equal(draws[0].RoundDraw.reason, 'TripleRon');
});

test('two claimants is still a legal, fully paid double ron', async () => {
  // The boundary matters: `>= 3` aborts, `2` must not.
  const t = makeTable();
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[3].hand = RON_HAND.slice();

  const before = t.scores.slice();
  const outcome = await t.finishHand(1, {
    type: 'ron', from: 2, tile: '2p',
    flags: { chankan: false, houtei: false },
    hits: [{ seat: 1 }, { seat: 3 }],
  });

  assert.equal(outcome.aborted, false, 'a double ron must not abort');
  assert.equal(sum(t), TOTAL);
  assert.equal(t.scores[1] - before[1], 1300);
  assert.equal(t.scores[3] - before[3], 1300);
});

test('a triple ron of one tile is order-independent', async () => {
  // The claim order must not change the outcome — it is a void hand either way.
  for (const hits of [[1, 2, 3], [3, 2, 1], [2, 1, 3]]) {
    const t = makeTable();
    t.ctx.players[1].hand = RON_HAND.slice();
    t.ctx.players[2].hand = RON_HAND.slice();
    t.ctx.players[3].hand = RON_HAND.slice();
    const before = t.scores.slice();
    const outcome = await t.finishHand(hits[0], {
      type: 'ron', from: 0, tile: '2p',
      flags: { chankan: false, houtei: false },
      hits: hits.map((seat) => ({ seat })),
    });
    assert.deepEqual(t.scores, before, `hits [${hits}] must pay nobody`);
    assert.ok(outcome && outcome.aborted, `hits [${hits}] must abort`);
  }
});

// --------------------------------------- post-settlement flow (the KI-21 seam)

// The riichi carry used to be re-derived in playOneHand AFTER finishHand had already
// zeroed ctx.riichiPool, which destroyed every stick left on a drawn hand. A
// finishHand-level test cannot see that: it never runs the code after settlement.
// These call the extracted method directly, which is the whole point of extracting
// it.

test('the riichi carry survives the post-settlement flow', async () => {
  const t = makeTable();
  setHands(t, []);
  declareRiichi(t, 0, 3);
  await t.finishHand(-1, null);
  assert.equal(t.riichiCarry, 3000, 'finishHand carried the pot');

  t.kyoku = 1;
  t.applyPostSettlementFlow({ outcome: { aborted: false }, winBy: null, winner: -1, dealer: 0 });

  assert.equal(t.riichiCarry, 3000,
    'the post-settlement flow must not overwrite the carry — this is the KI-21 leak');
  assert.equal(sum(t) + t.riichiCarry, TOTAL, 'and the points are still accounted for');
});

test('the post-settlement flow never re-derives the carry from a drained pool', () => {
  // Sweep the branch shapes with the hand pool already drained, which is the state
  // finishHand always leaves behind.
  const cases = [
    ['exhaustive', { aborted: false }, null],
    ['triple ron abort', { aborted: true }, { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 1 }, { seat: 2 }, { seat: 3 }] }],
    ['dealer ron', { aborted: false }, { type: 'ron', from: 1, tile: '2p', hits: [{ seat: 0 }] }],
    ['non-dealer ron', { aborted: false }, { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 2 }] }],
  ];
  for (const [label, outcome, winBy] of cases) {
    const t = makeTable();
    t.ctx.riichiPool = 0;   // drained by finishHand
    t.riichiCarry = 1000;   // a real pot waiting on the table
    t.honba = 0;
    t.applyPostSettlementFlow({ outcome, winBy, winner: -1, dealer: 0 });
    assert.equal(t.riichiCarry, 1000, `${label}: the carry must be left alone`);
  }
});

test('an abortive draw repeats the dealer and adds a honba', () => {
  const t = makeTable();
  t.honba = 0;
  t.kyoku = 2;
  const keep = t.applyPostSettlementFlow({
    outcome: { aborted: true },
    winBy: { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 1 }, { seat: 2 }, { seat: 3 }] },
    winner: 1,
    dealer: 0,
  });
  assert.equal(keep, true, 'the dealer repeats on an abortive draw');
  assert.equal(t.honba, 1, 'an abort adds a honba');
  assert.equal(t.kyoku, 1, 'the same hand is replayed');
});

test('a non-dealer win rotates the seat and clears the honba', () => {
  const t = makeTable();
  t.honba = 2;
  t.kyoku = 1;
  const keep = t.applyPostSettlementFlow({
    outcome: { aborted: false },
    winBy: { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 2 }] },
    winner: 2,
    dealer: 0,
  });
  assert.equal(keep, false, 'the seat rotates when a non-dealer wins');
  assert.equal(t.honba, 0, 'the honba counter resets');
});

test('a dealer win repeats the seat and adds a honba', () => {
  const t = makeTable();
  t.honba = 0;
  t.kyoku = 1;
  const keep = t.applyPostSettlementFlow({
    outcome: { aborted: false },
    winBy: { type: 'ron', from: 1, tile: '2p', hits: [{ seat: 0 }] },
    winner: 0,
    dealer: 0,
  });
  assert.equal(keep, true);
  assert.equal(t.honba, 1);
});

test('an exhaustive draw keeps the dealer only when the dealer is tenpai', () => {
  const withDealerTenpai = makeTable();
  setHands(withDealerTenpai, [0]);
  withDealerTenpai.honba = 0;
  withDealerTenpai.kyoku = 1;
  assert.equal(withDealerTenpai.applyPostSettlementFlow({ outcome: { aborted: false }, winBy: null, winner: -1, dealer: 0 }), true);
  assert.equal(withDealerTenpai.honba, 1);

  const withoutDealerTenpai = makeTable();
  setHands(withoutDealerTenpai, [1]);
  withoutDealerTenpai.honba = 0;
  withoutDealerTenpai.kyoku = 1;
  assert.equal(withoutDealerTenpai.applyPostSettlementFlow({ outcome: { aborted: false }, winBy: null, winner: -1, dealer: 0 }), false);
  assert.equal(withoutDealerTenpai.honba, 1, 'an exhaustive draw always adds a honba');
});

// ------------------------------------------------ playOneHand -> dealer rotation
//
// Every test above calls applyPostSettlementFlow directly, which means they cannot
// see how playOneHand CALLS it — and that is exactly where the bug was. playOneHand
// passed three arguments to a four-parameter signature, so `dealer` arrived as
// undefined, `dealerWon` was false for every hand and the dealer never kept the
// deal. All 97 server tests passed while the networked game was broken.
//
// These drive playOneHand itself and assert on this.dealer / this.honba / this.kyoku,
// which is the only level at which a wrong argument is observable.

// A Table that can run playOneHand to completion: the hand is dealt for real, then
// playTurn ends it immediately with a fixed result and finishHand is stubbed, so the
// only thing under test is the post-settlement wiring.
function makeHandRunner({ dealer = 0, kyoku = 1, honba = 0, tenpai = [], winner = -1, winBy = null }) {
  const t = makeTable();
  t.dealer = dealer;
  t.kyoku = kyoku;
  t.honba = honba;
  t.matchOver = false;
  t.totalRounds = 4;
  t.waitForReady = async () => {};
  t.broadcastPowerStatus = () => {};
  t.powerOf = () => 'none';
  t.isCpuSeat = () => true;
  t.clearMailbox = () => {};
  t.playTurn = async () => ({ end: true, winner, winBy });
  t.finishHand = async () => ({ aborted: false });
  t.tenpaiSeats = () => tenpai;
  return t;
}

test('playOneHand keeps the dealer when the dealer wins by tsumo', async () => {
  const t = makeHandRunner({ dealer: 0, winner: 0, winBy: { type: 'tsumo' } });
  await t.playOneHand();
  assert.equal(t.dealer, 0, 'the dealer must keep the deal on a dealer tsumo');
  assert.equal(t.honba, 1, 'a dealer win adds a honba');
  assert.equal(t.kyoku, 1, 'and the same hand number is replayed');
});

test('playOneHand keeps the dealer when the dealer wins by ron', async () => {
  const t = makeHandRunner({
    dealer: 2,
    winner: 2,
    winBy: { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 2 }] },
  });
  await t.playOneHand();
  assert.equal(t.dealer, 2, 'the dealer must keep the deal on a dealer ron');
  assert.equal(t.honba, 1, 'a dealer win adds a honba');
});

test('playOneHand keeps the dealer on a double ron that includes the dealer', async () => {
  const t = makeHandRunner({
    dealer: 3,
    winner: 3,
    winBy: { type: 'ron', from: 0, tile: '2p', hits: [{ seat: 1 }, { seat: 3 }] },
  });
  await t.playOneHand();
  assert.equal(t.dealer, 3, 'the dealer must keep the deal when it is one of two claimants');
});

test('playOneHand rotates the dealer when a non-dealer wins', async () => {
  const t = makeHandRunner({
    dealer: 0,
    honba: 2,
    winner: 2,
    winBy: { type: 'ron', from: 1, tile: '2p', hits: [{ seat: 2 }] },
  });
  await t.playOneHand();
  assert.equal(t.dealer, 1, 'the deal passes to the next seat');
  assert.equal(t.honba, 0, 'a non-dealer win clears the honba');
  assert.equal(t.kyoku, 2, 'and the hand number advances');
});

test('playOneHand keeps the dealer on an exhaustive draw when the dealer is tenpai', async () => {
  const t = makeHandRunner({ dealer: 0, kyoku: 1, honba: 0, tenpai: [0, 2] });
  await t.playOneHand();
  assert.equal(t.dealer, 0, 'a tenpai dealer keeps the deal at a draw');
  assert.equal(t.honba, 1, 'an exhaustive draw always adds a honba');
  assert.equal(t.kyoku, 1, 'and the same hand number is replayed');
});

test('playOneHand rotates the dealer on an exhaustive draw when the dealer is noten', async () => {
  const t = makeHandRunner({ dealer: 0, kyoku: 1, tenpai: [1, 3] });
  await t.playOneHand();
  assert.equal(t.dealer, 1, 'a noten dealer passes the deal');
  assert.equal(t.kyoku, 2, 'and the hand number advances');
});

// The same three hand shapes as above, swept over every dealer seat: `dealer` is a
// seat index and an off-by-one wiring bug can pass for a single seat while failing
// for another, so pin all four.
test('the dealer rotation holds for every dealer seat', async () => {
  for (let d = 0; d < 4; d++) {
    const onWin = makeHandRunner({ dealer: d, winner: d, winBy: { type: 'tsumo' } });
    await onWin.playOneHand();
    assert.equal(onWin.dealer, d, `P${d} must keep the deal when P${d} wins`);

    const onDraw = makeHandRunner({ dealer: d, tenpai: [d] });
    await onDraw.playOneHand();
    assert.equal(onDraw.dealer, d, `P${d} must keep the deal when P${d} is tenpai at a draw`);

    const offWin = makeHandRunner({
      dealer: d,
      winner: (d + 2) % 4,
      winBy: { type: 'ron', from: (d + 1) % 4, tile: '2p', hits: [{ seat: (d + 2) % 4 }] },
    });
    await offWin.playOneHand();
    assert.equal(offWin.dealer, (d + 1) % 4, `the deal must pass when a non-dealer wins against P${d}`);
  }
});

// ----------------------------------------------------------- match teardown

// These replace an earlier version that computed the expected redistribution in
// the test body and then asserted on its own arithmetic. They passed whether or
// not table.js did anything at all — a test that cannot fail is worse than no
// test, so they now drive run() and read what it actually broadcasts.

// Run a match that plays no hands, with `carry` left on the table beforehand.
// run() owns the teardown, so this exercises the real code path.
async function runToGameOver(t, carry) {
  const sent = [];
  t.broadcastMessage = (m) => sent.push(m);
  t.room.afterGameOver = () => {};
  t.playOneHand = async () => {};   // no hands: we are testing teardown only
  t.riichiCarry = carry;
  await t.run('ROOM');
  return sent;
}

function gameOverScores(sent) {
  const go = sent.find((m) => m && m.GameOver);
  assert.ok(go, 'run() did not broadcast GameOver');
  return go.GameOver.final_scores;
}

test('uncollected riichi sticks are forfeited at match end, not redistributed', async () => {
  const t = makeTable();
  // Fund the pot from a seat's score, exactly as a riichi declaration does.
  t.scores[0] -= 1000;
  assert.equal(sum(t), TOTAL - 1000, 'the stick left the scores and is on the table');

  const scores = gameOverScores(await runToGameOver(t, 1000));

  assert.equal(
    scores.reduce((a, b) => a + b, 0), TOTAL - 1000,
    'the leftover stick must be lost, not handed back',
  );
  assert.deepEqual(scores, [24000, 25000, 25000, 25000],
    'no seat may receive a share of the forfeited pot');
});

test('three forfeited sticks leave the total short by 3000', async () => {
  const t = makeTable();
  t.scores[0] -= 3000;
  const scores = gameOverScores(await runToGameOver(t, 3000));
  assert.equal(scores.reduce((a, b) => a + b, 0), TOTAL - 3000);
  assert.deepEqual(scores, [22000, 25000, 25000, 25000]);
});

test('a match that ends with an empty table still totals 100000', async () => {
  const t = makeTable();
  const scores = gameOverScores(await runToGameOver(t, 0));
  assert.equal(scores.reduce((a, b) => a + b, 0), TOTAL);
  assert.deepEqual(scores, [25000, 25000, 25000, 25000]);
});

test('run() does not zero the carry — it is reported, not silently cleared', async () => {
  // Keeps the teardown observable: the pot is left intact on the Table so the
  // final score gap can be explained, rather than vanishing mid-teardown.
  const t = makeTable();
  t.scores[0] -= 2000;
  await runToGameOver(t, 2000);
  assert.equal(t.riichiCarry, 2000, 'the forfeited pot should still be readable on the table');
});
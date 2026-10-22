// aborts.test.js — deterministic coverage for the four newly-wired server
// abortive draws (kyuushu/suufon/suucha/suukaikan), nagashi mangan, and the
// agari-yame/enchousen match-end gate.
//
// These paths are unreachable in bot play (rare by design), so each is driven
// directly against a headless Table — the same method that found KI-22's
// coverage gap. The shared predicates (isSuufonRenda/isSuukaikanAbort,
// distinctYaochuu, isNagashi) already have engine unit tests; what is pinned
// here is that Table *reaches* them and settles correctly.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Table, START_SCORE } = require('../table');

const TOTAL = 4 * START_SCORE;

// Headless Table: same scaffolding shape as settlement.test.js, plus the
// abort-path fields (callsMade, first-lap accumulator, kan counts, decide).
function makeTable() {
  const sent = [];
  const room = {
    powerSeats: ['none', 'none', 'none', 'none'],
    seats: [null, null, null, null], // all CPU unless a test installs humans
    sendTo() {},
    broadcastRoomState() {},
  };
  const t = new Table(room, 12345);
  t.broadcast = (m) => sent.push(m);
  t.broadcastMessage = () => {};
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];
  t.sent = sent;

  t.ctx = {
    players: [0, 1, 2, 3].map((s) => ({
      seat: s,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
    })),
    dealer: 0,
    bakaze: 1,
    doraInd: [],
    uraInd: [],
    dead: [],
    riichiPool: 0,
    callsMade: 0,
    drawsThisKyoku: 0,
    kansBy: [0, 0, 0, 0],
    kanCount: 0,
    rinshanIdx: 0,
    firstLapDiscards: [],
    suufonDone: false,
    fourRiichiPending: false,
    baseDora: () => [],
    uraDora: () => [],
    state: { powers: { onSettlement() {} }, flow: null },
  };
  return t;
}

const sum = (t) => t.scores.reduce((a, b) => a + b, 0);

// A 14-tile dealt hand with 9+ distinct terminal/honour kinds (legal kyuushu).
const KYUUSHU_HAND = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '2m', '3m', '4m', '5m', '6m'];
const PLAIN_HAND = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '2s', '3s', '4s', '5s', '6s'];

// ---------------------------------------------------------- kyuushu-kyuuhai

test('kyuushu: a CPU 9-kind hand declares (stubbed 0.8 roll passes)', () => {
  const t = makeTable();
  t.decide = { next: () => 0.1 };
  t.ctx.players[2].hand = KYUUSHU_HAND.slice();
  for (const s of [0, 1, 3]) t.ctx.players[s].hand = PLAIN_HAND.slice();
  assert.equal(t.checkKyuushu(), 2);
});

test('kyuushu: a CPU 9-kind hand can play on (stubbed roll fails)', () => {
  const t = makeTable();
  t.decide = { next: () => 0.9 };
  t.ctx.players[0].hand = KYUUSHU_HAND.slice();
  for (const s of [1, 2, 3]) t.ctx.players[s].hand = PLAIN_HAND.slice();
  assert.equal(t.checkKyuushu(), -1);
});

test('kyuushu: human 9-kind hands auto play on (no deal prompt on the wire)', () => {
  const t = makeTable();
  t.ctx.roomUnused = true;
  t.room.seats[1] = { kind: 'human' };
  t.ctx.players[1].hand = KYUUSHU_HAND.slice();
  for (const s of [0, 2, 3]) t.ctx.players[s].hand = PLAIN_HAND.slice();
  assert.equal(t.checkKyuushu(), -1);
});

test('kyuushu: no 9-kind hand means no abort', () => {
  const t = makeTable();
  for (const s of [0, 1, 2, 3]) t.ctx.players[s].hand = PLAIN_HAND.slice();
  assert.equal(t.checkKyuushu(), -1);
});

// ------------------------------------------------------- suucha/suufon lap

test('suucha-riichi: fourth riichi aborts on the quiet discard', () => {
  const t = makeTable();
  t.ctx.fourRiichiPending = true;
  assert.equal(t.checkLapAbort(), 'SuuchaRiichi');
  assert.equal(t.ctx.fourRiichiPending, false); // one-shot
  assert.equal(t.checkLapAbort(), null);
});

test('suufon-renda: four identical wind opens abort', () => {
  const t = makeTable();
  t.ctx.firstLapDiscards = ['1z', '1z', '1z', '1z'];
  assert.equal(t.checkLapAbort(), 'SuufonRenda');
  assert.equal(t.ctx.suufonDone, true);
});

test('suufon-renda: mixed winds play on (and only checked once)', () => {
  const t = makeTable();
  t.ctx.firstLapDiscards = ['1z', '1z', '2z', '1z'];
  assert.equal(t.checkLapAbort(), null);
  assert.equal(t.ctx.suufonDone, true);
  assert.equal(t.checkLapAbort(), null);
});

test('suufon-renda: incomplete accumulator plays on', () => {
  const t = makeTable();
  t.ctx.firstLapDiscards = ['1z', '1z', '1z'];
  assert.equal(t.checkLapAbort(), null);
  assert.equal(t.ctx.suufonDone, false);
});

test('suufon-renda: a call on the fourth discard voids the abort', () => {
  // The rule is "four identical wind opens, no calls". A call on the 4th
  // discard must therefore suppress the abort — including on a later quiet
  // discard, where the still-full accumulator would otherwise fire.
  const t = makeTable();
  t.ctx.firstLapDiscards = ['1z', '1z', '1z', '1z'];
  t.ctx.callsMade = 1;
  assert.equal(t.checkLapAbort(), null);
  assert.equal(t.ctx.suufonDone, false, 'not consumed; it simply can never fire');
});

// --------------------------------------------------------------- the switch

// The abort flags were dead config for the whole life of rules-config.js (KI-04).
// This drives the switch for real: with a flag off, the detection is reached but no
// abort is declared. (The suukaikan/triple-ron gates sit inline in the kan/ron paths,
// not in a method, so they are pinned by the source scan in rules-config-parity.test.js
// plus the default-enabled property of `abortEnabled`.)
test('serverAborts gates the detections: an explicit false suppresses the abort', () => {
  const { RULES } = require('../../engine/rules-config');
  const saved = { ...RULES.serverAborts };
  try {
    const k = makeTable();
    k.decide = { next: () => 0.1 };
    k.ctx.players[2].hand = KYUUSHU_HAND.slice();
    for (const s of [0, 1, 3]) k.ctx.players[s].hand = PLAIN_HAND.slice();
    assert.equal(k.checkKyuushu(), 2, 'baseline: kyuushu enabled');
    RULES.serverAborts.kyuushuKyuuhai = false;
    assert.equal(k.checkKyuushu(), -1, 'disabled: no kyuushu');

    RULES.serverAborts.suuchaRiichi = false;
    const s = makeTable();
    s.ctx.fourRiichiPending = true;
    assert.equal(s.checkLapAbort(), null, 'disabled: no suucha-riichi');
    assert.equal(s.ctx.fourRiichiPending, false, 'the one-shot flag is still consumed');

    RULES.serverAborts.suufonRenda = false;
    const f = makeTable();
    f.ctx.firstLapDiscards = ['1z', '1z', '1z', '1z'];
    assert.equal(f.checkLapAbort(), null, 'disabled: no suufon-renda');
  } finally {
    Object.assign(RULES.serverAborts, saved);
  }
});

// ---------------------------------------------------------------- settlement

test('abortHand: void hand, sticks carry, dealer repeats with +1 honba', async () => {
  const t = makeTable();
  t.scores[0] -= 1000;
  t.ctx.riichiPool = 1000;
  const before = sum(t);
  const outcome = await t.abortHand('SuufonRenda', {});
  assert.deepEqual(outcome, { aborted: true });
  assert.equal(t.ctx.riichiPool, 0);
  assert.equal(t.riichiCarry, 1000);
  assert.equal(sum(t), before); // no payments moved
  const keepDealer = t.applyPostSettlementFlow({ outcome, winBy: null, winner: -1, dealer: 0 });
  assert.equal(keepDealer, true);
  assert.equal(t.honba, 1);
  assert.equal(t.sent.length, 1);
});

test('chomboHand: offender pays a mangan, sticks carry, dealer repeats, honba unchanged', async () => {
  const t = makeTable();
  t.kyoku = 3;
  t.ctx.riichiPool = 2000;
  const before = sum(t);
  const outcome = await t.chomboHand(1);
  assert.deepEqual(outcome, { chombo: true });
  // Dealer 0: P1 pays 4000 to the dealer and 2000 to each non-dealer.
  assert.deepEqual(t.scores, [29000, 17000, 27000, 27000]);
  assert.equal(sum(t), before, 'the penalty only redistributes points');
  assert.equal(t.ctx.riichiPool, 0);
  assert.equal(t.riichiCarry, 2000, 'sticks stay on the table for the replay');
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0].RoundDraw.reason, /Chombo/);
  assert.equal(t.sent[0].RoundDraw.riichi_sticks, 2);

  const keepDealer = t.applyPostSettlementFlow({
    outcome,
    winBy: { type: 'chombo', offender: 1 },
    winner: -3,
    dealer: 0,
  });
  assert.equal(keepDealer, true, 'the dealer repeats');
  assert.equal(t.honba, 0, 'chombo leaves honba unchanged');
  assert.equal(t.kyoku, 2, 'kyokuRepeat rewinds so playOneHand replays the same kyoku');
});

test('suukaikan predicate: split kans abort, solo quad plays on', () => {
  const H = require('../../engine/helpers');
  assert.equal(H.isSuukaikanAbort([2, 1, 1, 0]), true);
  assert.equal(H.isSuukaikanAbort([4, 0, 0, 0]), false);
  assert.equal(H.isSuukaikanAbort([1, 1, 0, 0]), false);
});

// ------------------------------------------------------------------ nagashi

// Closed all-terminal discards with a noten hand: nagashi replaces noten.
const NAGASHI_DISCARDS = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z'];
const NOTEN_HAND = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '9s'];

test('nagashi mangan: closed terminal discarder wins mangan tsumo', async () => {
  const t = makeTable();
  t.ctx.players[1].discards = NAGASHI_DISCARDS.slice();
  t.ctx.players[1].hand = NOTEN_HAND.slice();
  for (const s of [0, 2, 3]) {
    t.ctx.players[s].discards = ['2m']; // open-claim-free but simple: disqualifies
    t.ctx.players[s].hand = NOTEN_HAND.slice();
  }
  const before = sum(t);
  const outcome = await t.finishHand(-1, null);
  assert.deepEqual(outcome.nagashiSeats, [1]);
  assert.equal(outcome.aborted, false);
  // Non-dealer mangan: dealer pays 4000, others 2000. Dealer P0: -4000.
  assert.deepEqual(t.scores, [21000, 25000 + 8000, 23000, 23000]);
  assert.equal(sum(t), before);
  // Rotation: dealer not among nagashi -> rotates.
  const keepDealer = t.applyPostSettlementFlow({
    outcome,
    winBy: { type: 'nagashi', hits: [{ seat: 1 }] },
    winner: 1,
    dealer: 0,
  });
  assert.equal(keepDealer, false);
});

test('nagashi mangan: dealer nagashi repeats the deal', async () => {
  const t = makeTable();
  t.ctx.players[0].discards = NAGASHI_DISCARDS.slice();
  t.ctx.players[0].hand = NOTEN_HAND.slice();
  for (const s of [1, 2, 3]) {
    t.ctx.players[s].discards = ['2m'];
    t.ctx.players[s].hand = NOTEN_HAND.slice();
  }
  const outcome = await t.finishHand(-1, null);
  assert.deepEqual(outcome.nagashiSeats, [0]);
  // Dealer mangan: 4000 all -> +12000.
  assert.deepEqual(t.scores, [25000 + 12000, 21000, 21000, 21000]);
  const keepDealer = t.applyPostSettlementFlow({
    outcome,
    winBy: { type: 'nagashi', hits: [{ seat: 0 }] },
    winner: 0,
    dealer: 0,
  });
  assert.equal(keepDealer, true);
  assert.equal(t.honba, 1);
});

// ------------------------------------------------- agari-yame / enchousen

test('agari-yame: leading dealer win at all-last ends the match', () => {
  const t = makeTable();
  t.scores = [35000, 22000, 22000, 21000];
  t.checkMatchEnd({ keepDealer: true, dealerWon: true, dealer: 0, allLast: true });
  assert.equal(t.matchOver, true);
  assert.equal(t.overtime, false);
});

test('no agari-yame without the lead: enchousen opens instead', () => {
  const t = makeTable();
  t.scores = [22000, 35000, 22000, 21000];
  t.checkMatchEnd({ keepDealer: true, dealerWon: true, dealer: 0, allLast: true });
  assert.equal(t.matchOver, false);
  assert.equal(t.overtime, true);
});

test('all-last rotation without a dealer win ends normally (no overtime)', () => {
  const t = makeTable();
  t.checkMatchEnd({ keepDealer: false, dealerWon: false, dealer: 0, allLast: true });
  assert.equal(t.matchOver, false);
  assert.equal(t.overtime, false);
});

test('enchousen: match ends on the first non-repeating hand', () => {
  const t = makeTable();
  t.overtime = true;
  t.checkMatchEnd({ keepDealer: true, dealerWon: true, dealer: 1, allLast: false });
  assert.equal(t.matchOver, false);
  t.checkMatchEnd({ keepDealer: false, dealerWon: false, dealer: 1, allLast: false });
  assert.equal(t.matchOver, true);
});

test('mid-match hands never touch the match gate', () => {
  const t = makeTable();
  t.checkMatchEnd({ keepDealer: true, dealerWon: true, dealer: 0, allLast: false });
  assert.equal(t.matchOver, false);
  assert.equal(t.overtime, false);
});

// ------------------------------------------------------- overtime han floor

test('winMeetsFloor: base game unchanged, overtime needs 2+ han', () => {
  const t = makeTable();
  const one = { isAgari: true, yakuman: 0, han: 1 };
  const two = { isAgari: true, yakuman: 0, han: 2 };
  const yaku = { isAgari: true, yakuman: 1, han: 0 };
  assert.equal(t.winMeetsFloor(one), true);
  t.overtime = true;
  assert.equal(t.winMeetsFloor(one), false);
  assert.equal(t.winMeetsFloor(two), true);
  assert.equal(t.winMeetsFloor(yaku), true);
});

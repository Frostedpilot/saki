// call-window.test.js — deterministic coverage for resolveCallWindow's
// arbitration and candidate collection.
//
// The bridge E2E test only ever has one human seat, and CPU candidates resolve
// synchronously, so the arbitration order was never actually exercised against
// out-of-order arrival. That let a real bug through: pon/daiminkan priority and
// riichi-stick collection were decided by *response arrival order* rather than
// turn order — correct by accident for CPU-only play, wrong as soon as two
// humans respond over the wire in the other order.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Table } = require('../table');

// Two-tile copies so a pon is available; a 13-tile shape that is not tenpai on
// the discarded tile so nobody can ron by accident.
function seatWithPair(tile) {
  const hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];
  hand.splice(3, 0, tile, tile);
  return hand.slice(0, 13);
}

// A 13-tile hand that genuinely wins on 2p: 123m 567m 555z 678s, waiting tanki on
// 2p. The 5z triplet is yakuhai Chun, so this is a legal ron in every seat wind —
// a bare 5z pair would have no yaku and `tryRon` would (correctly) reject it.
const RON_HAND = ['1m', '2m', '3m', '5m', '6m', '7m', '5z', '5z', '5z', '6s', '7s', '8s', '2p'];
const RON_TILE = '2p';

function makeTable({ from = 0 } = {}) {
  const room = {
    powerSeats: ['none', 'none', 'none', 'none'],
    sendTo() {},
    broadcastRoomState() {},
  };
  const t = new Table(room, 4242);
  t.broadcast = () => {};
  t.broadcastMessage = () => {};
  t.broadcastPowerStatus = () => {};
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];
  t.maybeActivateTier = () => {};
  t.powerOf = () => 'none';

  t.ctx = {
    players: [0, 1, 2, 3].map((s) => ({
      seat: s,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      tempFuriten: false,
      riichiWaits: [],
      lastDrawn: null,
      // Default to human seats: the CPU branch in resolveCallWindow ignores
      // request() entirely and always rons when able, which would make the
      // scripted out-of-order responses below dead code.
      isCpu: false,
    })),
    dealer: from,
    bakaze: 1,
    doraInd: [],
    uraInd: [],
    dead: [],
    kanCount: 0,
    rinshanIdx: 0,
    kansBy: [0, 0, 0, 0],
    callsMade: 0,
    drawsThisKyoku: 5,
    riichiPool: 0,
    poolTotal: () => 40,
    baseDora: () => [],
    uraDora: () => [],
    state: { powers: { hooksFor: () => null, onSettlement() {}, broadcastPlayerKan() {} }, flow: null },
  };

  // Record what doOpenCall / doOpenChi were asked to do instead of executing
  // the whole call pipeline.
  t.calls = [];
  t.doOpenCall = async (seat, fromSeat, tile, kind) => {
    t.calls.push({ kind, seat, from: fromSeat, tile });
    return { end: false, next: (seat + 1) % 4 };
  };
  t.doOpenChi = async (seat, fromSeat, tile, chosen) => {
    t.calls.push({ kind: 'chi', seat, from: fromSeat, tile, chosen });
    return { end: false, next: (seat + 1) % 4 };
  };

  // Candidate polling is replaced by a scripted, deliberately out-of-order set.
  t.scriptedResponses = null;
  t.request = async (seat) => {
    const scripted = t.scriptedResponses && t.scriptedResponses[seat];
    if (!scripted) return { type: 'Pass' };
    // Deliberately resolve in reverse arrival order to expose ordering bugs.
    if (t.deferred) return t.deferred(seat, scripted);
    return scripted;
  };
  t.cancelRequest = () => {};

  return t;
}

// Seats 1 and 3 both hold a pair of 5z; seat 0 discards a 5z.
function setupTwoPonCandidates(t) {
  t.ctx.players[1].hand = seatWithPair('5z');
  t.ctx.players[3].hand = seatWithPair('5z');
  t.ctx.players[2].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];
}

test('pon priority goes to the claimant nearest in turn order, not first response', async () => {
  const t = makeTable({ from: 0 });
  setupTwoPonCandidates(t);

  // Seats 1 and 3 both claim. Rank from seat 0: seat 1 is rank 1, seat 3 is rank 3,
  // so seat 1 must win — even though seat 3 answers first.
  t.scriptedResponses = { 1: { type: 'Pon' }, 3: { type: 'Pon' } };
  // Make seat 3's response resolve before seat 1's.
  t.deferred = (seat, action) => {
    if (seat === 3) return Promise.resolve(action); // nearest-last? no: rank 3
    if (seat === 1) return new Promise((r) => setTimeout(() => r(action), 5));
    return Promise.resolve(action);
  };

  await t.resolveCallWindow(0, '5z', {});
  assert.equal(t.calls.length, 1, 'exactly one call is arbitrated');
  assert.equal(t.calls[0].kind, 'pon');
  assert.equal(t.calls[0].seat, 1, 'the nearest claimant (seat 1) takes the pon');
});

test('pon priority holds when the discarder is seat 2', async () => {
  const t = makeTable({ from: 2 });
  // Turn order after seat 2 is: seat 3 (rank 1), seat 0 (rank 2), seat 1 (rank 3).
  t.ctx.players[3].hand = seatWithPair('5z');
  t.ctx.players[0].hand = seatWithPair('5z');
  t.ctx.players[1].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = { 3: { type: 'Pon' }, 0: { type: 'Pon' } };
  // Seat 0 answers first but is further away in turn order.
  t.deferred = (seat, action) => {
    if (seat === 0) return Promise.resolve(action);
    if (seat === 3) return new Promise((r) => setTimeout(() => r(action), 5));
    return Promise.resolve(action);
  };

  await t.resolveCallWindow(2, '5z', {});
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].seat, 3, 'seat 3 is rank 1 from seat 2 and must win');
});

test('ron beats a pon regardless of arrival order', async () => {
  const t = makeTable({ from: 0 });
  // Seat 1 can ron; seats 2/3 hold pairs to pon.
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[2].hand = seatWithPair(RON_TILE);
  t.ctx.players[3].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = {
    1: { type: 'Ron' },
    2: { type: 'Pon' },
  };
  t.deferred = (seat, action) => {
    // Seat 2 (the pon) answers immediately; seat 1 (the ron) answers later.
    if (seat === 2) return Promise.resolve(action);
    if (seat === 1) return new Promise((r) => setTimeout(() => r(action), 5));
    return Promise.resolve(action);
  };

  const out = await t.resolveCallWindow(0, RON_TILE, {});
  assert.equal(t.calls.length, 0, 'no open call is executed when someone rons');
  assert.equal(out.end, true);
  assert.equal(out.winner, 1);
});

test('the nearest ron claimant collects the hand, and hits are turn-ordered', async () => {
  const t = makeTable({ from: 0 });
  // Seats 1 and 3 both tenpai on the discarded tile.
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[3].hand = RON_HAND.slice();
  t.ctx.players[2].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = { 1: { type: 'Ron' }, 3: { type: 'Ron' } };
  // Seat 3 (rank 3) answers before seat 1 (rank 1).
  t.deferred = (seat, action) => {
    if (seat === 3) return Promise.resolve(action);
    if (seat === 1) return new Promise((r) => setTimeout(() => r(action), 5));
    return Promise.resolve(action);
  };

  const out = await t.resolveCallWindow(0, RON_TILE, {});
  assert.equal(out.end, true);
  assert.deepEqual(
    out.winBy.hits.map((h) => h.seat),
    [1, 3],
    'hits are in turn order, so hits[0] — who collects the riichi sticks — is the nearest'
  );
  assert.equal(out.winner, 1);
});

test('passing on an available ron sets temporary furiten', async () => {
  const t = makeTable({ from: 0 });
  // Seat 1 could ron but passes; seat 2 holds a pair and pons.
  t.ctx.players[1].hand = RON_HAND.slice();
  t.ctx.players[2].hand = seatWithPair(RON_TILE);
  t.ctx.players[3].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = { 1: { type: 'Pass' }, 2: { type: 'Pon' } };

  await t.resolveCallWindow(0, RON_TILE, {});
  assert.equal(t.ctx.players[1].tempFuriten, true, 'a player who declines a ron is in furiten until their next draw');
  assert.equal(t.ctx.players[2].tempFuriten, false);
});

test('a riichi seat is offered neither pon nor chi', async () => {
  const t = makeTable({ from: 0 });
  t.ctx.players[1].hand = seatWithPair('5z');
  t.ctx.players[1].riichi = true;
  t.ctx.players[2].hand = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '3p', '4p'];
  t.ctx.players[3].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  const sent = [];
  t.room.sendTo = (seat, msg) => sent.push({ seat, msg });

  t.scriptedResponses = {};
  await t.resolveCallWindow(0, '5z', {});

  const callWindows = sent.filter((s) => s.msg && s.msg.Event && s.msg.Event.CallAvailable);
  for (const cw of callWindows) {
    assert.notEqual(cw.seat, 1, 'a riichi seat is not polled for calls');
  }
});

test('chi is only ever offered to the seat to the discarder’s left', async () => {
  const t = makeTable({ from: 0 });
  // Seat 1 is kamicha and can chi; seat 2 is not.
  t.ctx.players[1].hand = ['3m', '4m', '6m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];
  t.ctx.players[2].hand = ['3m', '4m', '6m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '9s'];
  t.ctx.players[3].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = { 1: { type: 'Chi', tiles: [3, 4] } };
  await t.resolveCallWindow(0, '5m', {});
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].kind, 'chi');
  assert.equal(t.calls[0].seat, 1, 'only the kamicha seat may chi');
});

test('no candidates means the window resolves to no call', async () => {
  const t = makeTable({ from: 0 });
  // Nobody holds the discarded tile and nobody is tenpai on it.
  t.ctx.players[1].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];
  t.ctx.players[2].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];
  t.ctx.players[3].hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s'];

  t.scriptedResponses = {};
  const out = await t.resolveCallWindow(0, '5z', {});
  assert.equal(out, null, 'an uncontested discard passes straight through');
  assert.equal(t.calls.length, 0);
});

test('chankan does not open pon or chi, only ron', async () => {
  const t = makeTable({ from: 0 });
  t.ctx.players[1].hand = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '5z']; // can ron
  t.ctx.players[2].hand = seatWithPair('5z'); // would normally pon
  t.ctx.players[3].hand = ['3m', '4m', '6m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '8s']; // could chi

  t.scriptedResponses = { 1: { type: 'Ron' }, 2: { type: 'Pon' }, 3: { type: 'Chi' } };
  const out = await t.resolveCallWindow(0, '5z', { chankan: true });

  assert.equal(t.calls.length, 0, 'nobody may call on the added kan');
  assert.equal(out.end, true);
  assert.equal(out.winner, 1, 'only the ron is legal');
});

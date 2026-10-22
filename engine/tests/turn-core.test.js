'use strict';
// turn-core.test.js — the shared single-turn decisions (phase 3, KI-04).
//
// These pin the rules both drivers used to duplicate inline: own-kan
// availability, the call-candidate window, and call priority. Scoring is only
// involved for ron; the other cases are shape checks.
const test = require('node:test');
const assert = require('node:assert');
const TC = require('../turn-core');
const { RULES } = require('../rules-config');

const CTX = {
  dora: [],
  bakaze: 1,
  jikaze: 1,
  riichi: false,
  doubleRiichi: false,
  ippatsu: false,
  kanFlag: false,
  lastFlag: false,
  tenhou: false,
};

function pl(hand, extra = {}) {
  return {
    hand: [...hand],
    melds: [],
    discards: [],
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    tempFuriten: false,
    ...extra,
  };
}

// The seat after `from` has a complete ittsu waiting on 2p. The other seats
// hold unrelated tiles unless a test overrides them.
const RON_HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '2p'];
const FILLER = ['1z', '2z', '3z', '4z', '1z', '2z', '3z', '4z', '6s', '7s', '8s', '9s', '9s'];

function players(overrides = {}) {
  const out = [0, 1, 2, 3].map((seat) => pl(FILLER, { seat }));
  for (const [seat, p] of Object.entries(overrides)) out[Number(seat)] = p;
  return out;
}

function call(overrides, extra = {}) {
  return TC.callCandidates({
    from: 0,
    tile: '2p',
    players: players(overrides),
    dead: [],
    scoreCtxFor: () => CTX,
    ...extra,
  });
}

test('kanOptions: ankan from four copies, kakan from a pon plus the fourth', () => {
  const ankan = TC.kanOptions(pl(['1m', '1m', '1m', '1m', '2p']), {});
  assert.equal(ankan.ankanTile, '1m');
  assert.equal(ankan.canKan, true);

  const kakan = TC.kanOptions(
    pl(['1m', '2p'], { melds: [{ type: 'pon', tiles: ['1m', '1m', '1m'], open: true }] }),
    {}
  );
  assert.equal(kakan.ponUp.type, 'pon');
  assert.equal(kakan.kakanTile, '1m');
  assert.equal(kakan.canKan, true);
});

test('kanOptions: the kan budget and the rinshan budget suppress the offer', () => {
  const hand = pl(['1m', '1m', '1m', '1m']);
  assert.equal(TC.kanOptions(hand, { kanCount: RULES.maxKan }).blocked, 'kan-limit');
  assert.equal(TC.kanOptions(hand, { kanCount: RULES.maxKan }).canKan, false);
  assert.equal(TC.kanOptions(hand, { rinshanIdx: RULES.rinshanSlots }).blocked, 'rinshan-exhausted');
  assert.equal(TC.kanOptions(hand, { rinshanIdx: RULES.rinshanSlots }).canKan, false);
  assert.equal(TC.kanOptions(pl(['1z', '2z']), {}).canKan, false);
});

test('callCandidates: ron, pon, daiminkan and shimocha-only chi', () => {
  const out = call({
    1: pl(RON_HAND),
    2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]),
    3: pl(['1p', '3p', ...FILLER.slice(0, 11)]),
  });
  const bySeat = new Map(out.map((c) => [c.seat, c]));
  assert.ok(bySeat.get(1).ron, 'seat 1 can ron the ittsu wait');
  assert.equal(bySeat.get(2).pon.length, 3, 'three copies give three pon pairs');
  assert.equal(bySeat.get(2).daiminkan, true);
  assert.equal(bySeat.get(3).chi, null, 'chi is only offered to the shimocha (seat 1)');
  assert.equal(bySeat.get(3).pon, null);
});

test('callCandidates: a riichi seat is offered no open call', () => {
  const out = call({
    1: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)], { riichi: true }),
  });
  const c = out.find((x) => x.seat === 1);
  assert.equal(c.pon, null);
  assert.equal(c.chi, null);
  assert.equal(c.daiminkan, false);
});

test('callCandidates: canOpen suppresses open calls for the seats it rejects', () => {
  const out = call(
    {
      1: pl(RON_HAND),
      2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]),
    },
    { canOpen: () => false }
  );
  assert.ok(out.find((x) => x.seat === 1).ron);
  assert.equal(out.find((x) => x.seat === 2).pon, null);
  assert.equal(out.find((x) => x.seat === 2).daiminkan, false);
});

test('callCandidates: canOpen is per seat, so the CLI can keep human calls open', () => {
  const out = call(
    {
      2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]),
      3: pl(['2p', '2p', ...FILLER.slice(0, 11)]),
    },
    { canOpen: (seat) => seat === 2 }
  );
  assert.ok(out.find((x) => x.seat === 2).pon);
  assert.equal(out.find((x) => x.seat === 3).pon, null);
});

test('callCandidates: chankan opens ron only', () => {
  const out = call(
    {
      1: pl(RON_HAND),
      2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]),
    },
    { chankan: true }
  );
  assert.ok(out.find((x) => x.seat === 1).ron);
  assert.equal(out.find((x) => x.seat === 2).pon, null);
  assert.equal(out.find((x) => x.seat === 2).daiminkan, false);
});

test('callCandidates: the daiminkan needs kan and rinshan budget', () => {
  const hand = call({
    2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]),
  });
  assert.equal(hand.find((x) => x.seat === 2).daiminkan, true);
  assert.equal(
    call({ 2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]) }, { kanCount: RULES.maxKan }).find((x) => x.seat === 2)
      .daiminkan,
    false
  );
  assert.equal(
    call({ 2: pl(['2p', '2p', '2p', ...FILLER.slice(0, 10)]) }, { rinshanIdx: RULES.rinshanSlots }).find(
      (x) => x.seat === 2
    ).daiminkan,
    false
  );
});

test('arbitrateCalls: ron beats pon and chi regardless of response order', () => {
  const candidates = new Map([
    [1, { seat: 1, ron: { win: true }, pon: null, chi: null }],
    [2, { seat: 2, ron: null, pon: [[], []], chi: null }],
    [3, { seat: 3, ron: null, pon: null, chi: [['1', '2']] }],
  ]);
  const responses = [
    { seat: 3, type: 'Chi', tiles: ['1', '2'] },
    { seat: 2, type: 'Pon' },
    { seat: 1, type: 'Ron' },
  ];
  assert.deepEqual(TC.arbitrateCalls({ from: 0, candidates, responses }), {
    type: 'ron',
    claims: [{ seat: 1 }],
    passers: [],
  });
});

test('arbitrateCalls: the nearest pon claimant wins, not the first response', () => {
  const candidates = new Map([
    [1, { seat: 1, ron: null, pon: [[], []], chi: null }],
    [2, { seat: 2, ron: null, pon: [[], []], chi: null }],
  ]);
  const responses = [
    { seat: 2, type: 'Pon' },
    { seat: 1, type: 'Pon' },
  ];
  assert.equal(TC.arbitrateCalls({ from: 0, candidates, responses }).seat, 1);
});

test('arbitrateCalls: a passed ron is reported as temporary furiten', () => {
  const candidates = new Map([
    [1, { seat: 1, ron: { win: true }, pon: null, chi: null }],
    [2, { seat: 2, ron: null, pon: [[], []], chi: null }],
  ]);
  const responses = [
    { seat: 2, type: 'Pon' },
    { seat: 1, type: 'Pass' },
  ];
  assert.deepEqual(TC.arbitrateCalls({ from: 0, candidates, responses }), {
    type: 'pon',
    seat: 2,
    passers: [1],
  });
});

test('arbitrateCalls: a chi without tiles falls back to the first legal option', () => {
  const candidates = new Map([[1, { seat: 1, ron: null, pon: null, chi: [['1', '3']] }]]);
  assert.deepEqual(TC.arbitrateCalls({ from: 0, candidates, responses: [{ seat: 1, type: 'Chi' }] }), {
    type: 'chi',
    seat: 1,
    tiles: ['1', '3'],
    passers: [],
  });
});

test('arbitrateCalls: responses without a matching candidate are ignored', () => {
  const candidates = new Map([[1, { seat: 1, ron: null, pon: [[], []], chi: null }]]);
  assert.deepEqual(TC.arbitrateCalls({ from: 0, candidates, responses: [{ seat: 1, type: 'Ron' }] }), {
    type: null,
    passers: [],
  });
  assert.deepEqual(TC.arbitrateCalls({ from: 0, candidates, responses: [{ seat: 1, type: 'Kan' }] }), {
    type: null,
    passers: [],
  });
});

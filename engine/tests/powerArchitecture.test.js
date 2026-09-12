const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PowerDispatcher } = require('../powers/index');
const { DynamicPool } = require('../powers/dynamicPool');
const { FlowManager } = require('../powers/flowManager');
const { createRNG } = require('../rng');

const { createKoromoHooks, selectSecretWinningAnchor } = require('../powers/rosters/koromo');
const { createNodokaHooks } = require('../powers/rosters/nodoka');
const { createYuukiHooks } = require('../powers/rosters/yuuki');
const { createHisaHooks } = require('../powers/rosters/hisa');
const { createMakoHooks } = require('../powers/rosters/mako');
const { createSakiHooks } = require('../powers/rosters/kiyosumi');
const { createSakiNormalHooks } = require('../powers/rosters/saki-normal');
const { createYuuHooks } = require('../powers/rosters/achiga');
const { getAwakeningFactor, isOpponentRiichi, getRiichiDamping, scalePassiveWeight } = require('../powers/awakening');

function createMockState(hand = [], flowAmt = 150) {
  const pool = DynamicPool.full(createRNG(42));
  const flow = new FlowManager(4);
  flow.set(0, flowAmt);
  return {
    pool,
    flow,
    powers: new PowerDispatcher(),
    players: [
      { seat: 0, hand: [...hand], discards: [] },
      { seat: 1, hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1z'], discards: [] },
      { seat: 2, hand: ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '1p', '2p', '3p', '2z'], discards: [] },
      { seat: 3, hand: ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '4p', '5p', '6p', '3z'], discards: [] },
    ],
    dealer: 0,
    bakaze: 1,
    turn: 1,
    scores: [25000, 25000, 25000, 25000],
  };
}

test('polymorphic getTierInfo contract across all characters', () => {
  const state = createMockState([], 150);
  const rosters = [createKoromoHooks, createNodokaHooks, createYuukiHooks, createHisaHooks, createMakoHooks, createSakiHooks];

  for (const createHook of rosters) {
    const hook = createHook(0);
    assert.equal(typeof hook.getTierInfo, 'function', `${hook.meta.name} must implement getTierInfo`);
    const info = hook.getTierInfo(state);
    assert.equal(Array.isArray(info), true);
    assert.equal(info.length, 4, `${hook.meta.name} must return 4 tiers`);
    assert.equal(info[0].cost, 25);
    assert.equal(info[1].cost, 50);
    assert.equal(info[2].cost, 100);
    assert.equal(info[3].cost, 150);
    assert.equal(info[0].canAfford, true);
  }
});

test('player tier selection: armedTier = 0 (Conserve) prevents auto-firing', () => {
  const state = createMockState(['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '2z', '3z', '4z'], 150);
  const nodoka = createNodokaHooks(0);

  // Player explicitly chose to Conserve Flow
  const res = nodoka.onTurnStart(state, { armedTier: 0 });
  assert.equal(res.activated, false);
  assert.equal(res.reason, 'conserve');
  assert.equal(state.flow.get(0), 150, 'Flow must not be consumed when conserving');
});

test('player tier selection: armedTier = 1 activates Tier 1 and consumes 25 Flow', () => {
  const state = createMockState(['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '2z', '3z', '4z'], 150);
  const nodoka = createNodokaHooks(0);

  const res = nodoka.onTurnStart(state, { armedTier: 1 });
  assert.equal(res.activated, true);
  assert.equal(res.tier, 1);
  assert.equal(state.flow.get(0), 125, 'Flow must decrease by exactly 25 for Tier 1');
  assert.equal(nodoka._state().tier1TurnsLeft, 3);
});

test('player tier selection: Saki onKanDeclared respects armedTier', () => {
  const state = createMockState(['1m', '1m', '1m', '2p', '3p', '4p', '5s', '6s', '7s', '1z', '1z', '2z', '3z'], 100);
  const saki = createSakiHooks(0);

  // Conserve
  const conserveRes = saki.onKanDeclared(state, { armedTier: 0, kanCount: 1 });
  assert.equal(conserveRes.activated, false);
  assert.equal(state.flow.get(0), 100);

  // Arm Tier 1
  const t1Res = saki.onKanDeclared(state, { armedTier: 1, kanCount: 1 });
  assert.equal(t1Res.activated, true);
  assert.equal(t1Res.tier, 1);
  assert.equal(state.flow.get(0), 75);
});

test('performance benchmark: Koromo applyFieldAura executes in <0.2ms per draw', () => {
  const state = createMockState([], 150);
  const koromo = createKoromoHooks(0);
  koromo.tryActivateTier4(state, 10); // Activate abyss (-80% mire)

  const d = new PowerDispatcher();
  d.register(0, koromo);

  const oppHand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '2z', '3z'];
  state.players[1].hand = oppHand;

  const N = 1000;
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    d.computeDrawWeights(1, state, {});
  }
  const totalMs = performance.now() - start;
  const avgPerDrawMs = totalMs / N;

  assert.ok(avgPerDrawMs < 0.2, `Draw aura took ${avgPerDrawMs}ms on average, which is fast`);
});

test('persistent multi-hand state carries across hand executions', () => {
  const persistentStore = [{}, {}, {}, {}];
  const koromo1 = createKoromoHooks(0, persistentStore[0]);
  assert.equal(persistentStore[0].lunarHandCount, 1);

  // Second hand simulation reusing persistentStore
  const koromo2 = createKoromoHooks(0, persistentStore[0]);
  assert.equal(persistentStore[0].lunarHandCount, 2);
});

test('awakening curve formula: low threshold 15, full potential 80, flat 80-100', () => {
  assert.equal(getAwakeningFactor(0), 0.0);
  assert.equal(getAwakeningFactor(15), 0.0);
  assert.ok(Math.abs(getAwakeningFactor(25) - (10 / 65)) < 1e-9);
  assert.ok(Math.abs(getAwakeningFactor(50) - (35 / 65)) < 1e-9);
  assert.equal(getAwakeningFactor(80), 1.0);
  assert.equal(getAwakeningFactor(90), 1.0);
  assert.equal(getAwakeningFactor(100), 1.0);
});

test('riichi table pressure: 10% suppression on passive bonus when opponent riichis', () => {
  const state = createMockState();
  state.players[0].seat = 0;
  state.players[1].seat = 1;
  state.players[1].riichi = false;

  assert.equal(isOpponentRiichi(state, 0), false);
  assert.equal(getRiichiDamping(state, 0), 1.0);

  state.players[1].riichi = true;
  assert.equal(isOpponentRiichi(state, 0), true);
  assert.equal(getRiichiDamping(state, 0), 0.90);

  // Own riichi does not suppress self
  state.players[1].riichi = false;
  state.players[0].riichi = true;
  assert.equal(isOpponentRiichi(state, 0), false);
  assert.equal(getRiichiDamping(state, 0), 1.0);
});

test('Saki awakening curve & riichi table pressure', () => {
  const sakiHand = ['7p', '7p', '1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '1z', '1z'];
  const state = createMockState(sakiHand, 10);
  state.enableAwakening = true;
  state.scores = [25000, 25000, 25000, 25000];
  const hooks = createSakiHooks(0);

  // At flow 10 (<= 15): passive dormant (normal game)
  assert.equal(hooks.onPowerDraw('7p', state), 1.0);

  // At flow 80: full 1.35x potential
  state.flow.set(0, 80);
  assert.equal(hooks.onPowerDraw('7p', state), 1.35);

  // At flow 100: remains flat at 1.35x
  state.flow.set(0, 100);
  assert.equal(hooks.onPowerDraw('7p', state), 1.35);

  // Opponent Riichi dampens 35% bonus by 10% -> 1.0 + 0.35 * 0.90 = 1.315
  state.players[1].riichi = true;
  assert.ok(Math.abs(hooks.onPowerDraw('7p', state) - 1.315) < 1e-9);
});

test('Yuuki awakening curve & riichi table pressure', () => {
  const yuukiHand = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '4s', '5m', '6m', '7m', '1z'];
  const state = createMockState(yuukiHand, 10);
  state.enableAwakening = true;
  state.bakaze = 1; // East round
  const hooks = createYuukiHooks(0);

  // At flow 10 (<= 15): dormant speed affinity (1.0)
  assert.equal(hooks.onPowerDraw('2m', state), 1.0);

  // At flow 80: full 1.30x speed affinity
  state.flow.set(0, 80);
  assert.equal(hooks.onPowerDraw('2m', state), 1.30);

  // Opponent Riichi dampens 30% bonus by 10% -> 1.0 + 0.30 * 0.90 = 1.27
  state.players[2].riichi = true;
  assert.ok(Math.abs(hooks.onPowerDraw('2m', state) - 1.27) < 1e-9);

  // Active power (T1 Quick Bite at 8.0) is unaffected by Riichi
  state.flow.set(0, 100);
  hooks.tryActivateTier1(state, 1);
  assert.equal(hooks.onPowerDraw('1z', state), 8.0);
});

test('Hisa awakening curve & riichi table pressure', () => {
  // Hell wait hand (tanki wait on 7z)
  const tankiHand = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '7z'];
  const state = createMockState(tankiHand, 10);
  state.enableAwakening = true;
  const hooks = createHisaHooks(0);

  // At flow 10: normal game (hell wait boost dormant at 1.0)
  assert.equal(hooks.onPowerDraw('7z', state), 1.0);

  // At flow 80: full hell wait boost (3.0)
  state.flow.set(0, 80);
  assert.equal(hooks.onPowerDraw('7z', state), 3.0);

  // Opponent Riichi dampens hell wait bonus: 1.0 + (3.0 - 1.0) * 0.90 = 2.80
  state.players[1].riichi = true;
  assert.ok(Math.abs(hooks.onPowerDraw('7z', state) - 2.80) < 1e-9);

  // Active tier (T3 Chaos Slap, cost 100) is unaffected by opponent Riichi
  state.flow.set(0, 100);
  const r = hooks.tryActivateTier3(state);
  assert.equal(r.ok, true);
  assert.equal(hooks.onPowerDraw('7z', state), 12.0);
});

test('flow rosters declare type flow; normal rosters opt out of tiers', () => {
  const flowRosters = [createKoromoHooks, createNodokaHooks, createYuukiHooks, createHisaHooks, createMakoHooks, createSakiHooks];
  for (const createHook of flowRosters) {
    const hook = createHook(0);
    assert.equal(hook.meta.type, 'flow', `${hook.meta.name} must declare type flow`);
    assert.equal(hook.getTierInfo(createMockState()).length, 4);
  }
  const normalRosters = [createSakiNormalHooks, createYuuHooks];
  for (const createHook of normalRosters) {
    const hook = createHook(0);
    assert.equal(hook.meta.type, 'normal', `${hook.meta.name} must declare type normal`);
    assert.deepEqual(hook.getTierInfo(createMockState()), [], `${hook.meta.name} must expose no tiers`);
  }
});

test('normal-type seats are locked out of the Flow economy', () => {
  const flow = new FlowManager(4);
  flow.setMode(1, 'normal');
  assert.equal(flow.isNormal(1), true);
  flow.set(1, 99);
  flow.addFlow(1, 10);
  flow.consume(1, 10);
  flow.onLegalDiscard(1);
  assert.equal(flow.get(1), 0, 'normal seat must sit at 0 forever');
  assert.equal(flow.tier(1), 0);
  assert.equal(flow.canAfford(1, 25), false);

  flow.setMode(0, 'flow');
  flow.onLegalDiscard(0);
  assert.ok(flow.get(0) > 0, 'flow seat still banks income');
});

test('powerTypeOf routes flow vs normal by roster meta', () => {
  const d = new PowerDispatcher();
  d.register(0, createSakiHooks(0));
  d.register(1, createSakiNormalHooks(1));
  d.register(2, createYuuHooks(2));
  assert.equal(d.powerTypeOf(0), 'flow');
  assert.equal(d.powerTypeOf(1), 'normal');
  assert.equal(d.powerTypeOf(2), 'normal');
  assert.equal(d.powerTypeOf(3), 'flow', 'unregistered seats default to flow');
});

test('broadcastPlayerKan fans a kan to every registered hook', () => {
  const d = new PowerDispatcher();
  const sn0 = createSakiNormalHooks(0);
  const sn1 = createSakiNormalHooks(1);
  d.register(0, sn0);
  d.register(1, sn1);
  const state = createMockState([], 0);

  d.broadcastPlayerKan('garbage', state); // non-seat kan must not crash
  assert.equal(sn0.isPowerActive(state), true);

  d.broadcastPlayerKan(1, state); // seat 1 kans: p0 severed, p1 self unaffected
  assert.equal(sn0.isPowerActive(state), false);
  assert.equal(sn1.isPowerActive(state), true);
});

test('Koromo secret winning anchor: maximizes Han and selects least useful wait for opponents', () => {
  // Tenpai hand with waits on 1m (terminal, safe for opp) and 4m (opp waiting on it)
  // Hand: 2m 3m, 2p 3p 4p, 5s 6s 7s, 9p 9p 9p, 1z 1z -> wait 1m, 4m
  const hand = ['2m', '3m', '2p', '3p', '4p', '5s', '6s', '7s', '9p', '9p', '9p', '1z', '1z'];
  const state = createMockState(hand, 150);

  // Opponent 1 is tenpai waiting on 4m
  state.players[1].hand = ['2m', '3m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '2z', '2z']; // waits 1m, 4m

  // Opponent 2 has 1m in discards (genbutsu)
  state.players[2].discards = ['1m'];

  const anchor = selectSecretWinningAnchor(hand, state.pool, state.players, {
    seat: 0,
    bakaze: 1,
    jikaze: 4,
    dora: [],
  });

  // 1m has lower opponent utility (safe in p2 discards) compared to 4m (p1 tenpai wait)
  assert.equal(anchor, '1m');

  // Verify activation stores secretAnchor in persistent state
  const persistent = {};
  const koromo = createKoromoHooks(0, persistent);
  const res = koromo.tryActivateTier4(state, 10);
  assert.equal(res.ok, true);
  assert.equal(res.anchorTile, '1m');
  assert.equal(persistent.secretAnchor, '1m');

  // Counterplay: opponent open meld calls reduce Haitei win rate
  koromo.onOpponentMeld(1);
  assert.equal(koromo.onSettlement({}, state).haiteiWinRate, 0.75);
  koromo.onOpponentMeld(2);
  assert.equal(koromo.onSettlement({}, state).haiteiWinRate, 0.50);
  koromo.onOpponentMeld(3);
  assert.equal(koromo.onSettlement({}, state).haiteiWinRate, 0.0); // Stolen rhythm
});


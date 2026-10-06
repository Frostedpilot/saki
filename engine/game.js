#!/usr/bin/env node
// Full 4p offline CLI mahjong (Tonpuusen) - complete riichi rules.
// Bots: shanten-calculator discard (min-shanten + epsilon-random).
// Hacks: takayama-lily/riichi (yaku/score) + syanten (shanten).
// Complete: furiten (discard + temp), chankan (kakan + kokushi/ankan),
//   ippatsu (+double riichi), ura dora + kan dora, rinshan, haitei/houtei,
//   tenhou/chihou, honba, ryukyoku tenpai payments, riichi sticks,
//   double ron, triple-ron abort, kyuushu-kyuuhai abort (declare or play on),
//   suufon-renda abort, suucha-riichi abort, suukaikan abort (solo-quad continues),
//   South round (full hanchan: default --kyoku=8), tobi bust-out, dealer-tenpai
//   renchan at exhaustive, daiminkan, nagashi mangan, riichi needs 4+ wall tiles,
//   oka/uma + agari-yame/enchousen/shibari end conditions, ankan-after-riichi
//   chombo check, kuikae enforcement.
// Simplifications: no open-riichi, no sekinin-barai (pao).
// Both `--flag value` and `--flag=value` are accepted.
// Usage: node game.js [--powers none,saki,kuro,koromo,yuuki,hisa] [--human -1|0..3]
//        [--seed N] [--kyoku N] [--selftest=1]
//        [--closed-only=1] [--riichi-always=1] (demo flags: bots never open,
//        bots always riichi when able; default play unchanged)
//        [--demo-abort=NAME] fires the abortive-draw settlement once, after
//        the next clean discard (demo rare rulings on demand)
// NOTE: --powers here drives this file's inline powerDraw() rig, NOT the roster
// framework in engine/powers/rosters/. To exercise the real Flow-gauge powers,
// run the bridge server and play through the web client.
const { KINDS, norm, same, DORA_NEXT } = require('./tiles');
// Shared rule constants. The server front-end reads the same object, so the two
// implementations cannot drift on the numbers (see rules-config.js and KI-04).
const { RULES } = require('./rules-config');
const { scoreHand, meldStr } = require('./scoring');
const { createRNG } = require('./rng');
const { parseDiscardIndex } = require('./input');
// Shared rule helpers. This file used to keep its own verbatim copies of these;
// helpers.js was extracted out of game.js but game.js was never rewired to
// import them, so the two drifted and had to be "kept in sync" by hand. One
// definition each now — see engine/helpers.js.
const {
  shantenOf, hairiOf, getWaits, isDiscardFuriten, tryRon,
  botDiscard, botWantsCall, chiOptions, kuikaeBannedChi, countYaochuu,
  canRiichi, bakazeOf, roundLabel, clearAllIppatsu, ankanKeepsWaits,
  isSuufonRenda, isSuukaikanAbort, isNagashi, applyOkaUma,
} = require('./helpers');

const POWERS = ['none', 'saki', 'kuro', 'koromo', 'yuuki', 'hisa'];
// Accepts both `--flag=value` and `--flag value` (incl. negative values like
// `--human -1`). Previously only the `=` form parsed: `--kyoku 1` set
// args.kyoku === true, so parseInt(true) was NaN, KYOKU_N was NaN, and the
// match loop `for (kyoku = 0; kyoku < NaN; ...)` never ran — the game
// silently played zero hands and printed an all-ties match result.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    if (m[2] !== undefined) { out[key] = m[2]; continue; }
    const next = argv[i + 1];
    // A value is anything that isn't another flag. `-1` is a value, `--x` is not.
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// Flags that take a value. Given bare (`--powers` with nothing after it) the
// generic parser above stores boolean `true`, and that used to fail in three
// different ways depending on the flag: `--powers` threw a raw TypeError on
// `true.split(',')`, `--seed` seeded the RNG from NaN, and `--human` compared
// `seat === NaN` so it silently played an all-bot match as if you had asked for
// seat -1. Require the value and name the flag that was wrong.
function valueOf(key, example) {
  const v = args[key];
  if (v === undefined) return undefined;
  if (v !== true) return v;
  console.error(`--${key} needs a value, e.g. ${example}`);
  process.exit(1);
}

const rawPowers = valueOf('powers', '--powers none,none,saki,none');
const SEAT_POWERS = ((rawPowers === undefined ? 'none,none,none,none' : rawPowers).split(',').concat(['none', 'none', 'none', 'none'])).slice(0, 4);
const badPowers = SEAT_POWERS.filter(p => !POWERS.includes(p));
if (badPowers.length) {
  console.error(`unknown --powers value(s): ${badPowers.join(',')}`);
  console.error(`valid powers: ${POWERS.join(', ')}`);
  process.exit(1);
}
const rawHuman = valueOf('human', '--human 0');
const HUMAN = rawHuman === undefined ? -1 : parseInt(rawHuman, 10);
if (!Number.isInteger(HUMAN) || HUMAN < -1 || HUMAN > 3) {
  console.error(`--human must be -1 (all bots) or a seat 0-3 (got ${JSON.stringify(args.human)})`);
  process.exit(1);
}
const KYOKU_N = parseInt(args.kyoku || '8', 10); // 4 = tonpuusen, 8 = full hanchan
if (!Number.isFinite(KYOKU_N) || KYOKU_N < 1) {
  console.error(`--kyoku must be a positive integer (got ${JSON.stringify(args.kyoku)})`);
  process.exit(1);
}
// test/demo flags (default play unchanged): --closed-only=1 bots never pon/chi,
// --riichi-always=1 bots always riichi when able (shows ippatsu/ura/furiten fast)
const CLOSED_ONLY = args['closed-only'] === '1' || args['closed-only'] === true;
const RIICHI_ALWAYS = args['riichi-always'] === '1' || args['riichi-always'] === true;
// --demo-abort=NAME fires the shared abortive-draw settlement after the next
// clean discard (demo rare rulings on demand; trigger conditions unit-tested)
const DEMO_ABORT = args['demo-abort'] || null;
const rawSeed = valueOf('seed', '--seed 42');
if (rawSeed !== undefined) { // deterministic RNG for tests (mulberry32 via engine/rng.js)
  const seed = parseInt(rawSeed, 10);
  if (!Number.isFinite(seed)) {
    console.error(`--seed must be an integer (got ${JSON.stringify(args.seed)})`);
    process.exit(1);
  }
  const rng = createRNG(seed);
  Math.random = () => rng.next();
}

// ---------- tiles (shared: engine/tiles.js) ----------
function buildWall() {
  const w = [];
  for (const k of KINDS) for (let i = 0; i < 4; i++) w.push(k);
  for (const [five, aka] of [['5m', '0m'], ['5p', '0p'], ['5s', '0s']]) w[w.indexOf(five)] = aka;
  for (let i = w.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[w[i], w[j]] = [w[j], w[i]]; }
  return w;
}
// DORA_NEXT + KINDS: shared from engine/tiles.js
// shantenOf / hairiOf now come from ./helpers (see the require block at the top).
// meldStr: shared from engine/scoring.js

// scoring via shared engine/scoring.js (same signature + flags).

// All tiles of the 136 accounted for (for 5th-copy exclusion in waits)
function countVisible(tile, players, dead) {
  const k = norm(tile);
  let n = 0;
  for (const p of players) {
    for (const t of p.hand) if (norm(t) === k) n++;
    for (const m of p.melds) for (const t of m.tiles) if (norm(t) === k) n++;
    for (const t of p.discards) if (norm(t) === k) n++;
  }
  for (const t of dead) if (norm(t) === k) n++;
  return n;
}

// Waits/furiten/bot/abort/settlement helpers now come from ./helpers (see the
// require block at the top). getWaits, isDiscardFuriten and the rest used to be
// duplicated here verbatim.

// ---------- Saki power draw hook (per seat) ----------
function powerDraw(wall, hand, power, ctx) {
  const drawOne = () => wall.pop();
  if (!wall.length) return null;
  if (power === 'none') return drawOne();
  const base = shantenOf(hand);
  if (power === 'kuro') {
    const win = wall.slice(-8);
    const i = win.findIndex(t => ctx.dora.includes(norm(t)));
    if (i >= 0 && Math.random() < 0.7) return wall.splice(wall.length - 8 + i, 1)[0];
    return drawOne();
  }
  if (power === 'saki' || power === 'yuuki') {
    if (power === 'yuuki' && ctx.roundWind !== 'E') return drawOne();
    const t = drawOne();
    if (base <= 1 && wall.length && shantenOf([...hand, t].slice(-14)) >= base && Math.random() < 0.55) {
      wall.unshift(t); return drawOne();
    }
    return t;
  }
  if (power === 'koromo') {
    if (wall.length <= 10 && base <= 0 && Math.random() < 0.5) {
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      const i = wall.findIndex(t => waits.includes(norm(t)));
      if (i >= 0) return wall.splice(i, 1)[0];
    }
    return drawOne();
  }
  if (power === 'hisa' && base === 0 && wall.length && Math.random() < 0.25) {
    const h = hairiOf(hand);
    const waits = h && h.wait ? Object.keys(h.wait) : [];
    if (waits.length <= 2) {
      const i = wall.findIndex(x => waits.includes(norm(x)));
      if (i >= 0) { const t = drawOne(); wall.push(t); return wall.splice(i, 1)[0]; }
    }
  }
  return drawOne();
}

// ---------- bot brain, abort helpers, settlement ----------
// botDiscard, botWantsCall, chiOptions, countYaochuu, isSuufonRenda,
// isSuukaikanAbort, bakazeOf, roundLabel, canRiichi, kuikaeBannedChi,
// ankanKeepsWaits, applyOkaUma, isNagashi, clearAllIppatsu and tryRon all
// moved to ./helpers — one definition each, shared with the bridge server.

// ---------- selftest (deterministic rule checks) ----------
async function selftest() {
  let n = 0;
  const ok = (cond, msg) => { n++; if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } console.log(`ok ${n} - ${msg}`); };
  const C = (o) => ({ dora: [], bakaze: 1, jikaze: 2, riichi: false, doubleRiichi: false, ippatsu: false, kanFlag: false, lastFlag: false, tenhou: false, ...o });
  const P0 = { hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'], melds: [], discards: [], tempFuriten: false };
  const P0win = [...P0.hand, '3p']; // 14 tiles: tanki pair completed (tsumo cases)
  // ippatsu: closed tanki wait 3p, riichi+ippatsu tsumo
  let r = scoreHand(P0win, [], null, true, C({ riichi: true, ippatsu: true }));
  ok(r.isAgari && r.yaku['一発'] !== undefined, `ippatsu yaku present (${JSON.stringify(r.yaku)})`);
  // chankan: ron on 3p with kanFlag
  r = scoreHand(P0.hand, [], '3p', false, C({ kanFlag: true }));
  ok(r.isAgari && (r.yaku['槍槓'] !== undefined || r.yaku['搶槓'] !== undefined), `chankan yaku present (${JSON.stringify(r.yaku)})`);
  // rinshan: tsumo with kanFlag (needs a kan meld, as in real rinshan)
  // 11 closed (lib counts kan meld as 3: 11+3=14) + ankan = complete
  const rinClosed = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '3p', '3p'];
  r = scoreHand(rinClosed, [{ tiles: ['7s', '7s', '7s', '7s'], open: false, type: 'kan' }], null, true, C({ kanFlag: true }));
  ok(r.isAgari && r.yaku['嶺上開花'] !== undefined, `rinshan yaku present (${JSON.stringify(r.yaku)})`);
  // haitei / houtei
  r = scoreHand(P0win, [], null, true, C({ lastFlag: true }));
  ok(r.isAgari && r.yaku['海底摸月'] !== undefined, `haitei yaku present (${JSON.stringify(r.yaku)})`);
  r = scoreHand(P0.hand, [], '3p', false, C({ lastFlag: true }));
  ok(r.isAgari && r.yaku['河底撈魚'] !== undefined, `houtei yaku present (${JSON.stringify(r.yaku)})`);
  // double riichi
  r = scoreHand(P0win, [], null, true, C({ doubleRiichi: true }));
  ok(r.isAgari && r.yaku['ダブル立直'] !== undefined, `double riichi yaku present (${JSON.stringify(r.yaku)})`);
  // ura dora adds han: same hand with/without ura tile 3p as dora
  const noUra = scoreHand(P0win, [], null, true, C({}));
  const withUra = scoreHand(P0win, [], null, true, C({ dora: ['2p'] })); // 3p dora x1
  ok(withUra.han > noUra.han && withUra.yaku['ドラ'] !== undefined, `ura/kan dora adds han (${noUra.han}->${withUra.han})`);
  // waits + furiten
  const players = [P0, { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }];
  const waits = getWaits(P0, players, [], C({}));
  ok(waits.includes('3p'), `waits include 3p (${waits})`);
  ok(!isDiscardFuriten(P0, waits), 'no furiten on empty discards');
  P0.discards.push('3p');
  ok(isDiscardFuriten(P0, waits), 'discard furiten detected after dropping wait');
  // behavioral: tryRon blocks/permits end-to-end
  const mkQ = (discards, temp) => ({ hand: [...P0.hand], melds: [], discards: [...discards], tempFuriten: !!temp, riichi: false, doubleRiichi: false, ippatsu: false });
  const shoot = (kan) => C({ kanFlag: !!kan });
  const plist = [mkQ([], false), { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }];
  plist[0] = mkQ([], false);
  let att = tryRon(plist[0], '3p', shoot(false), plist, []);
  ok(att.win === true, 'ron wins with no furiten');
  att = tryRon(mkQ(['3p'], false), '3p', shoot(false), plist, []);
  ok(att.win === false && att.blocked && att.reason === 'discard', 'discard furiten blocks ron');
  att = tryRon(mkQ([], true), '3p', shoot(false), plist, []);
  ok(att.win === false && att.blocked && att.reason === 'temp', 'temp furiten blocks ron');
  att = tryRon(mkQ([], false), '3p', shoot(true), plist, [], { chankan: true });
  ok(att.win === true && (att.r.yaku['槍槓'] !== undefined || att.r.yaku['搶槓'] !== undefined), 'chankan ron wins via tryRon');
  att = tryRon(mkQ(['3p'], false), '3p', shoot(true), plist, [], { chankan: true });
  ok(att.win === false && att.blocked, 'furiten blocks chankan too');
  // combined attack flags as tsumoWin/rescore build them (riichi+ippatsu+ura)
  r = scoreHand(P0win, [], null, true, C({ riichi: true, ippatsu: true, dora: ['2p'] }));
  ok(r.isAgari && r.yaku['立直'] !== undefined && r.yaku['一発'] !== undefined && r.yaku['ドラ'] !== undefined,
    `combined riichi+ippatsu+ura scores (${JSON.stringify(r.yaku)})`);
  // double ron eligibility: TWO tenpai players both win the same tile
  const qa = mkQ([], false), qb = mkQ([], false);
  const pl2 = [qa, qb, { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }];
  const ra = tryRon(qa, '3p', shoot(false), pl2, []);
  const rb = tryRon(qb, '3p', shoot(false), pl2, []);
  ok(ra.win === true && rb.win === true, 'double ron: two players win same tile');
  // triple ron condition: three eligible winners
  const qc = mkQ([], false);
  const pl3 = [qa, qb, qc, { hand: [], melds: [], discards: [] }];
  const rc = tryRon(qc, '3p', shoot(false), pl3, []);
  ok(rc.win === true, 'triple ron: third player also wins (abortive in game)');
  // kyuushu counting: 9+ terminals/honors
  const yao = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
  ok(countYaochuu(yao) === 13, `kyuushu counts 13 yaochuu (${countYaochuu(yao)})`);
  ok(countYaochuu(P0.hand) === 2, `2 yaochuu (1m,9m) in test hand (${countYaochuu(P0.hand)})`);
  // abortive-draw conditions (pure helpers)
  ok(isSuufonRenda(['1z', '1z', '1z', '1z']) === true, 'suufon: four 1z');
  ok(isSuufonRenda(['1z', '1z', '1z', '2z']) === false, 'suufon: mixed winds rejected');
  ok(isSuufonRenda(['5m', '5m', '5m', '5m']) === false, 'suufon: non-wind rejected');
  ok(isSuufonRenda(['1z', '1z', '1z']) === false, 'suufon: needs exactly four');
  ok(isSuukaikanAbort([2, 1, 1, 0]) === true, 'suukaikan: split 2/1/1 aborts');
  ok(isSuukaikanAbort([4, 0, 0, 0]) === false, 'suukaikan: solo quad continues');
  ok(isSuukaikanAbort([1, 1, 0, 0]) === false, 'suukaikan: under four continues');
  // rounds / riichi-gate / nagashi helpers
  ok(bakazeOf(0) === 1 && bakazeOf(3) === 1 && bakazeOf(4) === 2 && bakazeOf(7) === 2, 'bakaze East 0-3, South 4-7');
  ok(roundLabel(0) === 'EAST 1' && roundLabel(5) === 'SOUTH 2', `round labels (${roundLabel(0)}/${roundLabel(5)})`);
  ok(canRiichi(1000, 4) === true && canRiichi(900, 10) === false && canRiichi(2000, 3) === false, 'riichi needs 1000pts + 4 wall tiles');
  const ng0 = { melds: [], discards: ['1m', '9p', '1z', '9s', '2z'] };
  const ng1 = { melds: [{ tiles: ['1m', '1m', '1m'], open: true, type: 'pon' }], discards: ['1m', '9p'] };
  const ng2 = { melds: [], discards: ['1m', '5p'] };
  ok(isNagashi(ng0) === true, 'nagashi: closed all-yaochuu discards');
  ok(isNagashi(ng1) === false, 'nagashi: open meld disqualifies');
  ok(isNagashi(ng2) === false, 'nagashi: simple discard disqualifies');
  ok(isNagashi({ melds: [], discards: [] }) === false, 'nagashi: empty discards rejected');
  // kuikae bans after chi (two HAND tiles used)
  ok(JSON.stringify(kuikaeBannedChi('2p', '3p')) === JSON.stringify(['1p', '4p']), 'kuikae: chi 2-3 bans 1,4');
  ok(JSON.stringify(kuikaeBannedChi('1s', '3s')) === JSON.stringify(['2s']), 'kuikae: kanchan chi bans called tile');
  ok(JSON.stringify(kuikaeBannedChi('8m', '9m')) === JSON.stringify(['7m']), 'kuikae: penchan chi bans called tile');
  // ankan-after-riichi wait check (tanki quad keeps, shanpon quad breaks)
  const seqs = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'];
  const wctx = { dora: [], bakaze: 1, jikaze: 1 };
  const lkKeep = [...seqs, '7p', '7p', '7p', '4p']; // tanki 4p only
  const plKeep = { hand: [...lkKeep, '7p'], melds: [], riichiWaits: getWaits({ hand: lkKeep, melds: [] }, [], [], wctx) };
  ok(JSON.stringify(plKeep.riichiWaits) === JSON.stringify(['4p']), `riichi waits tanki (${plKeep.riichiWaits})`);
  ok(ankanKeepsWaits(plKeep, '7p') === true, 'ankan keeps tanki waits: legal');
  const lkBreak = [...seqs, '3p', '3p', '4p', '4p']; // shanpon 3p/4p
  const plBreak = { hand: [...lkBreak, '3p'], melds: [], riichiWaits: getWaits({ hand: lkBreak, melds: [] }, [], [], wctx) };
  ok(ankanKeepsWaits(plBreak, '3p') === false, `ankan breaks shanpon waits (${plBreak.riichiWaits}): chombo`);
  // oka/uma placement
  const t1 = applyOkaUma([31000, 26000, 24000, 19000]);
  ok(t1.map(r => r.total).join(',') === '41,6,-16,-31', `oka/uma basics (${t1.map(r => r.total)})`);
  const t2 = applyOkaUma([25000, 25000, 25000, 25000]);
  ok(t2.every(r => r.total === 0), 'oka/uma all-tie zeros out');
  const t3 = applyOkaUma([30000, 30000, 20000, 20000]);
  ok(t3[0].total === 25 && t3[1].total === 25 && t3[2].total === -25 && t3[3].total === -25, `oka/uma tied groups (${t3.map(r => r.total)})`);
  console.log(`\nSELFTEST PASS (${n} checks)`);
}

// ---------- game ----------
async function main() {
  if (args.selftest !== undefined && args.selftest !== false && (args.selftest === true || args.selftest === '1')) return selftest();
  const readline = HUMAN >= 0 ? require('readline').createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = q => new Promise(res => readline.question(q, res));
  const scores = [RULES.startScore, RULES.startScore, RULES.startScore, RULES.startScore];
  const names = SEAT_POWERS.map((p, i) => `P${i}(${p})${i === HUMAN ? '[YOU]' : ''}`);
  let dealer = 0, honba = 0, riichiCarry = 0;
  let demoAbortOnce = DEMO_ABORT; // one-shot for the whole match (else redeal loops forever)
  let safety = 0; // infinite-redeal guard (pathological abort streaks)
  let overtime = false; // enchousen: extra hands past all-last (ryanhan-shibari active)

  for (let kyoku = 0; kyoku < KYOKU_N; kyoku++) {
    if (++safety > KYOKU_N + 50) { console.log('SAFETY STOP: too many redeals'); break; }
    const bakaze = bakazeOf(kyoku), jikazeOf = p => ((p - dealer + 4) % 4) + 1;
    const wallFull = buildWall();
    // dead wall layout: [0..3] rinshan, dora ind dead[4,6,8,10,12], ura dead[5,7,9,11,13]
    const dead = wallFull.splice(0, 14);
    let rinshanIdx = 0, kanCount = 0, callsMade = 0, drawsThisKyoku = 0;
    const kansBy = [0, 0, 0, 0];
    const firstLapDiscards = []; // for suufon-renda (first discard each, no calls)
    let suufonDone = false;
    let fourRiichiPending = false; // set when 4th riichi declared; checked after its discard
    const doraInd = [dead[4]], uraInd = [dead[5]];
    const revealKanDora = () => {
      kanCount++;
      const di = 4 + kanCount * 2, ui = 5 + kanCount * 2;
      if (di < 14) { doraInd.push(dead[di]); uraInd.push(dead[ui]); }
    };
    const baseDora = () => doraInd.map(DORA_NEXT);
    const ctx = { dora: baseDora(), bakaze, jikaze: 1, riichi: false, roundWind: 'E', riichiPool: riichiCarry };
    riichiCarry = 0;
    const P = [0, 1, 2, 3].map(i => ({
      id: i, hand: [], melds: [], discards: [], riichi: false, doubleRiichi: false,
      ippatsu: false, tempFuriten: false, power: SEAT_POWERS[i],
    }));
    for (let k = 0; k < 13; k++) for (let i = 0; i < 4; i++) P[(dealer + i) % 4].hand.push(wallFull.pop());
    const sortH = h => h.sort((a, b) => norm(a) < norm(b) ? -1 : 1);
    P.forEach(p => sortH(p.hand));
    console.log(`\n=== ${roundLabel(kyoku)}${overtime ? ' ENCHOUSEN' : ''} dealer=${names[dealer]} honba=${honba} dora=${doraInd}(${ctx.dora}) scores=${scores.join('/')} ===`);
    // --- kyuushu-kyuuhai: 9+ terminals/honors may abort the deal ---
    // declarer chooses: abortive draw (same dealer replay, honba+1) or play on.
    let kyuushuAbort = false;
    for (let k = 0; k < 4 && !kyuushuAbort; k++) {
      const q = (dealer + k) % 4;
      const terms = countYaochuu(P[q].hand);
      if (terms >= 9) {
        let declare = false;
        if (P[q].id === HUMAN) {
          console.log(`  YOUR dealt hand: ${P[q].hand.join(' ')} (${terms} terminals/honors)`);
          const a = (await ask('  declare KYUUSHU-KYUUHAI abortive draw, or play on? (abort/play): ')).trim().toLowerCase();
          declare = a.startsWith('abort') || a === 'a' || a === 'y';
        } else {
          // bots: keep kokushi-shaped hands (many distinct terminals), else abort
          const distinct = new Set(P[q].hand.filter(t => { const c = norm(t); return c[1] === 'z' || c[0] === '1' || c[0] === '9'; }).map(norm)).size;
          declare = distinct < 9 && Math.random() < 0.8;
        }
        if (declare) {
          console.log(`  ${names[q]} declares KYUUSHU-KYUUHAI (${terms} yaochuuhai) - abortive draw`);
          kyuushuAbort = true;
        } else console.log(`  ${names[q]} holds ${terms} terminals/honors but plays on`);
      }
    }
    if (kyuushuAbort) {
      honba++;
      riichiCarry = ctx.riichiPool; // sticks stay on the table for the redeal
      console.log(`scores unchanged: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry}) - redeal, same dealer`);
      kyoku--; // replay same kyoku number
      continue; // skips dealer rotation: same dealer redeals
    }
    let turn = dealer, winner = -1, winBy = null, draws = 0;
    let demoAbort = demoAbortOnce; demoAbortOnce = null;
    const allLast = kyoku === KYOKU_N - 1;
    const minHan = overtime ? 2 : 1; // ryanhan-shibari during enchousen
    if (overtime) console.log('  ryanhan-shibari: wins need 2+ han');

    const declareRiichi = (pl, firstClass, locked13) => {
      pl.riichi = true; pl.doubleRiichi = firstClass;
      pl.ippatsu = true; // expires on any call or on declarer's next discard
      scores[pl.id] -= RULES.riichiValue; ctx.riichiPool += RULES.riichiValue;
      // snapshot waits: later ankans must not change them (else chombo)
      pl.riichiWaits = locked13 ? getWaits({ hand: [...locked13], melds: [] }, P, dead, { dora: [], bakaze, jikaze: 1 }) : [];
      console.log(`  ${names[pl.id]} ${firstClass ? 'DOUBLE RIICHI' : 'RIICHI'}`);
      if (P.every(p => p.riichi)) {
        fourRiichiPending = true; // abort after this discard unless someone rons it
        console.log('  SUUCHA-RIICHI: all four riichi');
      }
    };
    const isFirstTurn = () => callsMade === 0 && drawsThisKyoku <= 4;
    // Ron collection: EVERY eligible player wins (double ron), furiten
    // enforced, human prompted per seat, turn-ordered. 3 winners = triple
    // ron (caller handles as abortive draw). flags: {houtei, chankan, label}
    async function collectRon(tile, fromTurn, flags = {}) {
      const hits = [];
      for (let k = 1; k <= 3; k++) {
        const q = (fromTurn + k) % 4;
        const qp = P[q];
        const cs = {
          dora: baseDora(), bakaze, jikaze: jikazeOf(q),
          riichi: qp.riichi, doubleRiichi: qp.doubleRiichi, ippatsu: qp.ippatsu,
          kanFlag: !!flags.chankan, lastFlag: !!flags.houtei, tenhou: false,
        };
        const att = tryRon(qp, tile, cs, P, dead, { chankan: !!flags.chankan, minHan: flags.minHan || 1 });
        if (att.win) {
          if (qp.id === HUMAN) {
            console.log(`  ${flags.label || 'RON'} available on ${tile}: ${att.r.text} ${JSON.stringify(att.r.yaku)}`);
            const a = (await ask(`  ${flags.label || 'ron'}? (y/n): `)).trim();
            if (!a.toLowerCase().startsWith('y')) { qp.tempFuriten = true; continue; }
          }
          hits.push({ seat: q });
        } else if (att.blocked) console.log(`  ${names[q]} FURITEN (${att.reason}) - ron on ${tile} blocked`);
      }
      return hits;
    }
    function ronWinResultMulti(hits, from, tile, flags = {}) {
      const wins = hits.map(h => ({
        seat: h.seat,
        r: rescore(P[h.seat], P[h.seat].hand, P[h.seat].melds, tile, false, {
          bakaze, jikaze: jikazeOf(h.seat), riichi: P[h.seat].riichi, doubleRiichi: P[h.seat].doubleRiichi,
          ippatsu: P[h.seat].ippatsu, kanFlag: !!flags.chankan, lastFlag: !!flags.houtei, tenhou: false,
        }),
      }));
      const tag = [
        flags.chankan && (flags.label || 'CHANKAN'),
        flags.houtei && 'HOUTEI',
        wins.some(w => P[w.seat].ippatsu) && 'IPPATSU',
        wins.length > 1 && 'DOUBLE RON',
      ].filter(Boolean).join(' ');
      return { type: 'ron', from, wins, tile, tag };
    }

    while (wallFull.length > 0 && draws < 200) {
      draws++; drawsThisKyoku++;
      const me = P[turn];
      // Permanent riichi furiten: a riichi passer stays furiten for the
      // remainder of the kyoku, so the flag must NOT clear on their draws.
      if (!me.riichi && !me.doubleRiichi) me.tempFuriten = false;
      ctx.jikaze = jikazeOf(turn);
      const isLastDraw = wallFull.length === 1;
      const t = powerDraw(wallFull, me.hand, me.power, ctx);
      if (!t) break;
      me.hand.push(t);
      const firstDrawOfKyoku = me.discards.length === 0 && me.melds.length === 0 && callsMade === 0 && drawsThisKyoku <= 4;

      // --- kakan (added kan): pon meld + 4th tile in hand ---
      const ponUp = me.melds.find(m => m.type === 'pon' && me.hand.some(h => same(h, m.tiles[0])));
      const cnt = {};
      me.hand.forEach(x => { const k = norm(x); cnt[k] = (cnt[k] || 0) + 1; });
      const ankanTile = Object.keys(cnt).find(k => cnt[k] === 4);
      let kanChoice = null; // {kind:'ankan'|'kakan', tile}
      if (kanCount < 4 && rinshanIdx < 4) {
        if (me.id === HUMAN) {
          if (ankanTile || ponUp) {
            console.log(`  YOUR hand: ${me.hand.join(' ')} melds=${JSON.stringify(me.melds.map(meldStr))}`);
            const a = (await ask(`  declare KAN? (${[ankanTile && 'ankan ' + ankanTile, ponUp && 'kakan ' + norm(ponUp.tiles[0])].filter(Boolean).join('/')} / n): `)).trim().toLowerCase();
            if (a.startsWith('ankan') && ankanTile) {
              if (me.riichi && !ankanKeepsWaits(me, ankanTile)) {
                console.log('  WARNING: this ankan changes your riichi waits = CHOMBO (mangan penalty).');
                const c = (await ask('  declare anyway? (y/n): ')).trim().toLowerCase();
                if (c.startsWith('y')) { winner = -3; winBy = { type: 'chombo', offender: turn }; break; }
              } else kanChoice = { kind: 'ankan', tile: ankanTile };
            }
            else if (a.startsWith('kakan') && ponUp) {
              // Adding a kan to an existing pon moves a tile out of the concealed
              // hand and into the meld, which can change the wait. Standard
              // riichi forbids it outright while in riichi (unlike ankan, which
              // is legal if the waits are unchanged).
              if (me.riichi) console.log('  ILLEGAL: cannot add a kan to a pon while in riichi (chombo).');
              else kanChoice = { kind: 'kakan', tile: norm(ponUp.tiles[0]) };
            }
          }
        } else {
          if (ankanTile && Math.random() < 0.5) {
            // bots never chombo: skip ankans that change riichi waits
            if (!me.riichi || ankanKeepsWaits(me, ankanTile)) kanChoice = { kind: 'ankan', tile: ankanTile };
            else console.log(`  ${names[me.id]} skips ANKAN ${ankanTile} (would change riichi waits)`);
          }
          else if (ponUp && Math.random() < 0.35) {
            // bots never chombo: no kakan while in riichi (see above)
            if (me.riichi) console.log(`  ${names[me.id]} skips KAKAN (illegal while in riichi)`);
            else kanChoice = { kind: 'kakan', tile: norm(ponUp.tiles[0]) };
          }
        }
      }
      let afterKan = false;
      if (kanChoice) {
        const kt = kanChoice.tile;
        if (kanChoice.kind === 'kakan') {
          // CHANKAN check before meld upgrade (furiten applies, multi-ron possible)
          const ckHits = await collectRon(kt, turn, { chankan: true, label: 'CHANKAN', minHan });
          if (ckHits.length === 3) {
            winner = -2;
            winBy = { type: 'abort', reason: `TRIPLE RON (chankan) on ${kt}` };
            break;
          }
          if (ckHits.length > 0) {
            winner = ckHits[0].seat;
            winBy = ronWinResultMulti(ckHits, turn, kt, { chankan: true, label: `CHANKAN ${names[turn]} kakan ${kt}` });
            break;
          }
          const pm = me.melds.find(m => m.type === 'pon' && same(m.tiles[0], kt));
          const i = me.hand.findIndex(x => same(x, kt));
          pm.tiles.push(me.hand.splice(i, 1)[0]); pm.type = 'kan';
          console.log(`  ${names[turn]} KAKAN ${kt}`);
        } else {
          // closed kan: kokushi-only chankan exception
          let ckWin = -1, ckR = null;
          for (let k = 1; k <= 3; k++) {
            const q = (turn + k) % 4;
            const qp = P[q];
            if (!qp.hand.length || qp.melds.length) continue;
            const cs = { dora: baseDora(), bakaze, jikaze: jikazeOf(q), riichi: qp.riichi, doubleRiichi: qp.doubleRiichi, ippatsu: qp.ippatsu, kanFlag: true, lastFlag: false, tenhou: false };
            const att = tryRon(qp, kt, cs, P, dead, { chankan: true });
            if (att.win && att.r.yaku['国士無双'] !== undefined) { ckWin = q; ckR = att.r; break; }
          }
          if (ckWin >= 0) {
            winner = ckWin;
            winBy = chankanWin(P[ckWin], ckWin, turn, kt, ckR, `CHANKAN (kokushi) on ANKAN ${kt}`);
            break;
          }
          const tiles = [];
          for (let c = 0; c < 4; c++) { const i = me.hand.findIndex(x => same(x, kt)); tiles.push(me.hand.splice(i, 1)[0]); }
          me.melds.push({ tiles, open: false, type: 'kan' });
          console.log(`  ${names[turn]} CLOSED KAN ${kt}`);
        }
        revealKanDora(); ctx.dora = baseDora();
        console.log(`  new dora=${ctx.dora}`);
        callsMade++; clearAllIppatsu(P);
        kansBy[turn]++;
        if (isSuukaikanAbort(kansBy)) {
          winner = -2;
          winBy = { type: 'abort', reason: `SUUKAIKAN (four kans: ${kansBy.join('/')})` };
          break;
        }
        if (kanCount >= 4) console.log('  four kans by one player - play continues');
        if (rinshanIdx >= 4) { console.log('  no rinshan tiles left'); continue; }
        const rt = dead[rinshanIdx++];
        me.hand.push(rt);
        console.log(`  ${names[turn]} rinshan draw ${rt}`);
        afterKan = true;
        // fall through to tsumo check on rinshan tile
        ctx.jikaze = jikazeOf(turn);
        const trs = scoreHand(me.hand, me.melds, rt, true, {
          dora: baseDora(), bakaze, jikaze: jikazeOf(turn),
          riichi: me.riichi, doubleRiichi: me.doubleRiichi, ippatsu: me.ippatsu,
          kanFlag: true, lastFlag: false, tenhou: false,
        });
        if (trs.isAgari && (trs.yakuman > 0 || trs.han >= minHan)) {
          winner = turn;
          winBy = tsumoWin(me, turn, trs, true, false);
          break;
        }
        if (overtime && trs.isAgari && trs.han > 0 && me.id === HUMAN) console.log('  shibari: rinshan win under 2 han - passing');
        // no rinshan win -> must discard (skip normal draw, reuse discard path below via goto-style)
        // set t=null marker: continue to discard section with current hand
      }
      // --- tsumo check (flags: rinshan/afterKan, haitei, tenhou, riichi/double+ippatsu) ---
      const tsumoFlags = {
        dora: baseDora(), bakaze, jikaze: jikazeOf(turn),
        riichi: me.riichi, doubleRiichi: me.doubleRiichi, ippatsu: me.ippatsu,
        kanFlag: afterKan, lastFlag: isLastDraw && !afterKan,
        tenhou: firstDrawOfKyoku && !afterKan,
      };
      const tr = afterKan ? null : scoreHand(me.hand, me.melds, t, true, tsumoFlags);
      const tsumoOk = tr && tr.isAgari && (tr.yakuman > 0 || tr.han >= minHan);
      if (tr && tr.isAgari && tr.han > 0 && !tsumoOk && me.id === HUMAN) console.log('  shibari: tsumo under 2 han - passing');
      if (tsumoOk) {
        let declare = true;
        if (me.id === HUMAN) {
          console.log(`  YOUR hand: ${me.hand.join(' ')} melds=${JSON.stringify(me.melds.map(meldStr))}`);
          console.log(`  TSUMO available: ${tr.text} ${JSON.stringify(tr.yaku)} ten=${tr.ten}`);
          const a = (await ask('  tsumo? (y/n): ')).trim();
          declare = a.toLowerCase().startsWith('y');
        }
        if (declare) { winner = turn; winBy = tsumoWin(me, turn, tr, afterKan, isLastDraw && !afterKan); break; }
      }
      // --- discard ---
      let di;
      if (me.id === HUMAN) {
        console.log(`  YOUR hand(${me.hand.length}): ${me.hand.join(' ')} shanten=${shantenOf(me.hand)} dora=${ctx.dora}`);
        const waits0 = getWaits({ ...me, hand: me.hand.filter((_, i) => i !== me.hand.length - 1) }, P, dead, { dora: [], bakaze, jikaze: 1 });
        void waits0;
        const h = me.hand.length >= 13 ? hairiOf(me.hand.slice(0, 13).length ? me.hand.slice(0, Math.min(me.hand.length, 14)) : me.hand) : null;
        if (h && h.now !== undefined) console.log(`  hairi now=${h.now}`);
        const myWaits = getWaits(me, P, dead, { dora: [], bakaze, jikaze: 1 });
        if (myWaits.length && me.discards.some(d => myWaits.includes(norm(d)))) console.log('  *** YOU ARE FURITEN (ron blocked) ***');
        const a = (await ask('  discard? (tile or index): ')).trim();
        di = parseDiscardIndex(a, me.hand);
        if (!me.riichi && me.melds.every(m => !m.open) && shantenOf(me.hand.filter((_, i) => i !== di)) === 0) {
          const q = (await ask('  declare riichi? (y/n): ')).trim();
          if (q.toLowerCase().startsWith('y') && canRiichi(scores[turn], wallFull.length)) {
            declareRiichi(me, isFirstTurn(), me.hand.filter((_, i) => i !== di));
          }
          else if (q.toLowerCase().startsWith('y')) console.log('  riichi denied (need 1000pts + 4 wall tiles)');
        }
      } else {
        // single discard choice reused for the riichi test AND the cut
        // (two separate botDiscard calls could disagree under epsilon-random
        // and declare riichi on a non-tenpai hand)
        di = botDiscard(me.hand, me.riichi);
        if (!me.riichi && me.melds.every(m => !m.open)) {
          if (shantenOf(me.hand.filter((_, i) => i !== di)) === 0 && canRiichi(scores[turn], wallFull.length)) {
            const riichiP = RIICHI_ALWAYS ? 1 : 0.45;
            if (Math.random() < riichiP) declareRiichi(me, isFirstTurn(), me.hand.filter((_, i) => i !== di));
          }
        }
      }
      const disc = me.hand.splice(di, 1)[0];
      me.discards.push(disc);
      me.ippatsu = false; // one lap over for declarer
      const isHoutei = wallFull.length === 0;
      if (draws % 8 === 0 || me.riichi) console.log(`  ${names[turn]} discard ${disc} (sh=${shantenOf(me.hand)}) discards:${me.discards.slice(-6).join('')}`);
      else console.log(`  ${names[turn]} cut ${disc} (sh=${shantenOf(me.hand)})`);
      // suufon-renda tracking: first discard of each seat while no call made yet
      if (callsMade === 0 && me.discards.length === 1) firstLapDiscards.push(disc);

      // --- ron check: double ron possible, triple ron aborts, furiten enforced ---
      const hits = await collectRon(disc, turn, { houtei: isHoutei, minHan });
      if (hits.length === 3) {
        winner = -2;
        winBy = { type: 'abort', reason: `TRIPLE RON on ${disc}` };
        break;
      }
      if (hits.length > 0) {
        winner = hits[0].seat;
        winBy = ronWinResultMulti(hits, turn, disc, { houtei: isHoutei });
        break;
      }
      // no ron on this discard: abortive draws trigger here (wins take precedence)
      if (fourRiichiPending) {
        fourRiichiPending = false;
        winner = -2;
        winBy = { type: 'abort', reason: 'SUUCHA-RIICHI (four riichi, 4th discard unclaimed)' };
        break;
      }
      if (demoAbort) {
        const reason = demoAbort; demoAbort = null;
        winner = -2;
        winBy = { type: 'abort', reason };
        break;
      }
      if (!suufonDone && firstLapDiscards.length === 4) {
        suufonDone = true;
        if (isSuufonRenda(firstLapDiscards)) {
          winner = -2;
          winBy = { type: 'abort', reason: `SUUFON-RENDA (${firstLapDiscards.join(' ')})` };
          break;
        }
      }
      // --- pon / daiminkan / chi (break ippatsu for everyone) ---
      let called = false;
      for (let k = 1; k <= 3 && !called; k++) {
        const q = (turn + k) % 4;
        if (P[q].riichi) continue;
        const nSame = P[q].hand.filter(t => same(t, disc)).length;
        const canDaimin = nSame >= 3 && kanCount < 4 && rinshanIdx < 4 && !CLOSED_ONLY;
        if (nSame >= 2) {
          let removed = 0; const tmp = [...P[q].hand];
          for (const x of [...tmp]) { if (same(x, disc) && removed < 2) { tmp.splice(tmp.indexOf(x), 1); removed++; } }
          const gain = shantenOf(P[q].hand) - shantenOf(tmp);
          // choice: 'kan' | 'pon' | null
          let choice = null;
          if (P[q].id === HUMAN) {
            const a = canDaimin
              ? (await ask(`  ${disc} KAN / PON / pass? (k/p/n): `)).trim().toLowerCase()
              : (await ask(`  ${disc} PON? (y/n): `)).trim().toLowerCase();
            choice = (a === 'k' || a === 'kan') && canDaimin ? 'kan' : ((a === 'y' || a === 'p' || a === 'pon') ? 'pon' : null);
          } else if (CLOSED_ONLY) {
            choice = null;
          } else if (canDaimin && Math.random() < 0.25) {
            choice = 'kan';
          } else if (botWantsCall(gain, CLOSED_ONLY)) {
            choice = 'pon';
          }
          if (choice === 'kan') {
            const tiles = [];
            for (let c = 0; c < 3; c++) { const i = P[q].hand.findIndex(x => same(x, disc)); tiles.push(P[q].hand.splice(i, 1)[0]); }
            tiles.push(disc); me.discards.pop();
            P[q].melds.push({ tiles, open: true, type: 'kan' });
            console.log(`  ${names[q]} DAIMINKAN ${disc}`);
            callsMade++; clearAllIppatsu(P);
            kansBy[q]++;
            if (isSuukaikanAbort(kansBy)) {
              winner = -2;
              winBy = { type: 'abort', reason: `SUUKAIKAN (four kans: ${kansBy.join('/')})` };
              break;
            }
            revealKanDora(); ctx.dora = baseDora();
            console.log(`  new dora=${ctx.dora}`);
            const rt = dead[rinshanIdx++];
            P[q].hand.push(rt);
            console.log(`  ${names[q]} rinshan draw ${rt}`);
            ctx.jikaze = jikazeOf(q);
            const trs = scoreHand(P[q].hand, P[q].melds, rt, true, {
              dora: baseDora(), bakaze, jikaze: jikazeOf(q),
              riichi: false, doubleRiichi: false, ippatsu: false,
              kanFlag: true, lastFlag: false, tenhou: false,
            });
            if (trs.isAgari && (trs.yakuman > 0 || trs.han >= minHan)) {
              winner = q;
              winBy = tsumoWin(P[q], q, trs, true, false);
              break;
            }
            const dc = await discardAfterCall(P[q], q, jikazeOf, ask);
            const hitsD = await collectRon(dc, q, { houtei: wallFull.length === 0, minHan });
            if (hitsD.length === 3) {
              winner = -2;
              winBy = { type: 'abort', reason: `TRIPLE RON on ${dc}` };
              break;
            }
            if (hitsD.length > 0) {
              winner = hitsD[0].seat;
              winBy = ronWinResultMulti(hitsD, q, dc, { houtei: wallFull.length === 0 });
              break;
            }
            turn = (q + 1) % 4; called = true;
          } else if (choice === 'pon') {
            const tiles = [];
            for (let c = 0; c < 2; c++) { const i = P[q].hand.findIndex(x => same(x, disc)); tiles.push(P[q].hand.splice(i, 1)[0]); }
            tiles.push(disc); me.discards.pop();
            P[q].melds.push({ tiles, open: true, type: 'pon' });
            console.log(`  ${names[q]} PON ${disc}`);
            callsMade++; clearAllIppatsu(P);
            const dc = await discardAfterCall(P[q], q, jikazeOf, ask, [norm(tiles[0])]); // kuikae: no 4th tile
            const hitsQ = await collectRon(dc, q, { houtei: wallFull.length === 0, minHan });
            if (hitsQ.length === 3) {
              winner = -2;
              winBy = { type: 'abort', reason: `TRIPLE RON on ${dc}` };
              break;
            }
            if (hitsQ.length > 0) {
              winner = hitsQ[0].seat;
              winBy = ronWinResultMulti(hitsQ, q, dc, { houtei: wallFull.length === 0 });
              break;
            }
            turn = (q + 1) % 4; called = true;
          }
        }
      }
      if (winner >= 0) break;
      if (called) continue;
      const nx = (turn + 1) % 4;
      if (!P[nx].riichi) {
        const opts = chiOptions(P[nx].hand, disc);
        if (opts.length) {
          let doIt = P[nx].id === HUMAN ? null : (!CLOSED_ONLY && Math.random() < 0.35);
          if (P[nx].id === HUMAN) {
            const a = (await ask(`  ${disc} CHI ${opts.map(o => o.join('+')).join('/')}? (y/n): `)).trim();
            doIt = a.toLowerCase().startsWith('y');
          }
          if (doIt) {
            const o = opts[Math.floor(Math.random() * opts.length)];
            const tiles = [disc];
            for (const nn of o) { const i = P[nx].hand.findIndex(x => norm(x) === nn + norm(disc)[1]); tiles.push(P[nx].hand.splice(i, 1)[0]); }
            me.discards.pop();
            P[nx].melds.push({ tiles, open: true, type: 'chi' });
            console.log(`  ${names[nx]} CHI ${disc} [${o}]`);
            callsMade++; clearAllIppatsu(P);
            const dc = await discardAfterCall(P[nx], nx, jikazeOf, ask, kuikaeBannedChi(tiles[1], tiles[2]));
            const hitsX = await collectRon(dc, nx, { houtei: wallFull.length === 0, minHan });
            if (hitsX.length === 3) {
              winner = -2;
              winBy = { type: 'abort', reason: `TRIPLE RON on ${dc}` };
              break;
            }
            if (hitsX.length > 0) {
              winner = hitsX[0].seat;
              winBy = ronWinResultMulti(hitsX, nx, dc, { houtei: wallFull.length === 0 });
              break;
            }
            turn = (nx + 1) % 4; continue;
          }
        }
      }
      turn = (turn + 1) % 4;
    }

    function finalDoraFor(pl) {
      // ura revealed only for riichi winners
      if (pl.riichi || pl.doubleRiichi) return baseDora().concat(uraInd.slice(0, doraInd.length).map(DORA_NEXT));
      return baseDora();
    }
    function rescore(pl, closed, melds, tile, isTsumo, flags) {
      const dora = finalDoraFor(pl);
      if (pl.riichi || pl.doubleRiichi) {
        const ura = uraInd.slice(0, doraInd.length).map(DORA_NEXT);
        if (ura.length) console.log(`  ura dora: ${ura} (dora=${dora})`);
      }
      return scoreHand(closed, melds, tile, isTsumo, { ...flags, dora });
    }
    function tsumoWin(pl, seat, r0, rinshan, haitei) {
      const r = rescore(pl, pl.hand, pl.melds, null, true, {
        bakaze, jikaze: jikazeOf(seat), riichi: pl.riichi, doubleRiichi: pl.doubleRiichi,
        ippatsu: pl.ippatsu, kanFlag: rinshan, lastFlag: haitei,
        tenhou: pl.discards.length === 0 && pl.melds.length <= 1 && callsMade <= 1 && drawsThisKyoku <= 4 && !rinshan ? true : false,
      });
      const tag = [rinshan && 'RINSHAN', haitei && 'HAITEI', pl.ippatsu && 'IPPATSU', pl.doubleRiichi && 'W-RIICHI'].filter(Boolean).join(' ');
      return { type: 'tsumo', r, tag };
    }
    function chankanWin(pl, seat, from, tile, r0, label) {
      const r = rescore(pl, pl.hand, pl.melds, tile, false, {
        bakaze, jikaze: jikazeOf(seat), riichi: pl.riichi, doubleRiichi: pl.doubleRiichi,
        ippatsu: pl.ippatsu, kanFlag: true, lastFlag: false, tenhou: false,
      });
      return { type: 'ron', from, r, tile, tag: label };
    }
    async function discardAfterCall(pl, seat, jikazeOfFn, askFn, banned = []) {
      ctx.jikaze = jikazeOfFn(seat);
      const isBanned = t => banned.includes(norm(t));
      let dc;
      if (pl.id === HUMAN) {
        for (;;) {
          console.log(`  YOUR hand: ${pl.hand.join(' ')}`);
          const a = (await askFn(`  discard after call?${banned.length ? ` (kuikae ban: ${banned.join(' ')})` : ''} `)).trim();
          let d2 = pl.hand.findIndex(x => x === a || norm(x) === a);
          if (d2 < 0) d2 = pl.hand.length - 1;
          if (isBanned(pl.hand[d2])) { console.log('  kuikae: that discard is illegal after your call - choose another.'); continue; }
          dc = pl.hand.splice(d2, 1)[0]; break;
        }
      } else {
        const d2 = botDiscard(pl.hand, false, banned);
        dc = pl.hand.splice(d2, 1)[0];
      }
      pl.discards.push(dc);
      pl.ippatsu = false;
      console.log(`  ${names[seat]} cut ${dc} (sh=${shantenOf(pl.hand)})`);
      return dc;
    }

    let keepDealer = false;
    let matchOver = false;
    if (winBy && winBy.type === 'chombo') {
      const o = winBy.offender;
      console.log(`\n*** CHOMBO ${names[o]} (illegal ankan after riichi) - mangan penalty, replay ***`);
      if (o === dealer) { for (let i = 0; i < 4; i++) if (i !== o) { scores[i] += 4000; scores[o] -= 4000; } }
      else { for (let i = 0; i < 4; i++) if (i !== o) { const c = i === dealer ? 4000 : 2000; scores[i] += c; scores[o] -= c; } }
      riichiCarry = ctx.riichiPool; // sticks stay on the table
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry})`);
      kyoku--; keepDealer = true; // replay same kyoku, honba unchanged
    } else if (winBy && winBy.type === 'abort') {
      console.log(`\n*** ABORTIVE DRAW (${winBy.reason}) ***`);
      honba++; riichiCarry = ctx.riichiPool;
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry}) - redeal, same dealer`);
      kyoku--; // replay same kyoku number
      keepDealer = true;
    } else if (winner >= 0) {
      const dealerWon = winBy.type === 'tsumo' ? winner === dealer : winBy.wins.some(w => w.seat === dealer);
      if (winBy.type === 'tsumo') {
        const r = winBy.r;
        console.log(`\n*** TSUMO ${names[winner]} ${winBy.tag || ''} ${r.text} ${JSON.stringify(r.yaku)} ten=${r.ten} ***`);
        if (winner === dealer) { for (let i = 0; i < 4; i++) if (i !== winner) { const pay = r.oya[0] + RULES.honbaTsumo * honba; scores[i] -= pay; scores[winner] += pay; } }
        else { for (let i = 0; i < 4; i++) if (i !== winner) { const base = i === dealer ? r.ko[0] : r.ko[1]; const pay = base + RULES.honbaTsumo * honba; scores[i] -= pay; scores[winner] += pay; } }
        scores[winner] += ctx.riichiPool; ctx.riichiPool = 0;
      } else {
        // ron: single or double. Discarder pays each winner; sticks go to
        // the winner nearest in turn order (wins[0]).
        console.log(`\n*** ${winBy.wins.length > 1 ? 'DOUBLE ' : ''}RON on ${winBy.tile} from ${names[winBy.from]} ${winBy.tag || ''} ***`);
        for (const w of winBy.wins) {
          const pay = w.r.ten + RULES.honbaRon * honba;
          scores[winBy.from] -= pay; scores[w.seat] += pay;
          console.log(`  -> ${names[w.seat]} ${w.r.text} ${JSON.stringify(w.r.yaku)} +${pay}`);
        }
        scores[winBy.wins[0].seat] += ctx.riichiPool; ctx.riichiPool = 0;
      }
      console.log(`scores: ${scores.join('/')}`);
      if (scores.some(s => s < 0)) {
        console.log(`TOBI BUST-OUT (${names[scores.findIndex(s => s < 0)]}) - match over`);
        matchOver = true;
      }
      else if (allLast && dealerWon && scores[dealer] > Math.max(...scores.filter((_, i) => i !== dealer))) {
        // agari-yame: leading dealer at all-last may end the match
        let end = true;
        if (P[dealer].id === HUMAN) {
          const a = (await ask('  you lead at all-last as dealer - end match or renchan? (end/renchan): ')).trim().toLowerCase();
          end = !a.startsWith('rench');
        }
        if (end) { console.log('AGARI-YAME: leading dealer ends the match'); matchOver = true; }
        else { overtime = true; console.log('ENCHOUSEN (overtime): dealer continues'); honba++; kyoku--; keepDealer = true; }
      }
      else if (dealerWon) {
        console.log('dealer renchan'); honba++; kyoku--; keepDealer = true;
        if (allLast) { overtime = true; console.log('ENCHOUSEN (overtime): dealer continues'); }
      }
      else honba = 0;
    } else {
      console.log('\n*** EXHAUSTIVE DRAW ***');
      // ryukyoku tenpai payments
      const tenpai = P.map(p => getWaits(p, P, dead, { dora: [], bakaze, jikaze: 1 }).length > 0);
      if (process.env.DEBUG_END) {
        P.forEach((p, i) => console.log(`  end ${names[i]} closed=${p.hand.join('')} melds=${p.melds.map(meldStr)} sh=${shantenOf(p.hand)} waits=${getWaits(p, P, dead, { dora: [], bakaze, jikaze: 1 })}`));
      }
      const nTen = tenpai.filter(Boolean).length;
      console.log(`tenpai: ${P.map((p, i) => tenpai[i] ? names[i] : 'x').join(' ')}`);
      // nagashi mangan replaces the noten exchange
      const nagashi = [0, 1, 2, 3].filter(i => isNagashi(P[i]));
      if (nagashi.length) {
        console.log(`NAGASHI MANGAN: ${nagashi.map(i => names[i]).join(' ')} (all discards terminals/honors, closed)`);
        const order = [0, 1, 2, 3].map(k => (dealer + k) % 4).filter(i => nagashi.includes(i));
        for (const w of order) {
          if (w === dealer) { for (let i = 0; i < 4; i++) if (i !== w) { const pay = 4000 + RULES.honbaTsumo * honba; scores[i] -= pay; scores[w] += pay; } }
          else { for (let i = 0; i < 4; i++) if (i !== w) { const pay = (i === dealer ? 4000 : 2000) + RULES.honbaTsumo * honba; scores[i] -= pay; scores[w] += pay; } }
          console.log(`  -> ${names[w]} mangan tsumo`);
        }
        scores[order[0]] += ctx.riichiPool; ctx.riichiPool = 0;
      } else if (nTen > 0 && nTen < 4) {
        // standard: 1 tenpai: +3000/-1000; 2: +1500/-1500; 3: +1000/-3000
        const give = [0, RULES.notenTotal, RULES.notenTotal / 2, RULES.notenTotal / 3][nTen], take = [0, RULES.notenTotal / 3, RULES.notenTotal / 2, RULES.notenTotal][nTen];
        for (let i = 0; i < 4; i++) scores[i] += tenpai[i] ? give : -take;
        console.log(`noten payments (ten ${nTen}: +${give}/-${take})`);
      }
      honba++;
      riichiCarry = ctx.riichiPool;
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry})`);
      if (scores.some(s => s < 0)) {
        console.log(`TOBI BUST-OUT (${names[scores.findIndex(s => s < 0)]}) - match over`);
        matchOver = true;
      } else {
        keepDealer = tenpai[dealer]; // dealer repeats when tenpai at exhaustive
        console.log(keepDealer ? 'dealer tenpai renchan' : 'dealer noten, rotates');
        if (keepDealer) kyoku--; // replay same kyoku number
        if (keepDealer && allLast && !matchOver) { overtime = true; console.log('ENCHOUSEN (overtime): dealer tenpai at all-last'); }
      }
    }
    if (matchOver) break;
    if (!keepDealer) dealer = (dealer + 1) % 4;
  }
  console.log('\n=== MATCH RESULT (oka 20 / uma +20/+10/-10/-20) ===');
  for (const r of applyOkaUma(scores)) {
    const f = n => (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));
    console.log(`  ${r.place}. P${r.seat} raw=${r.score} uma=${f(r.uma)} oka=${f(r.oka)} total=${f(r.total)}`);
  }
  console.log(`FINAL(raw): ${scores.join('/')}`);
  if (readline) readline.close();
}

// Only play a match when invoked directly. Without this guard, requiring this
// file from a test started a full hanchan on import.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

// Testable surface. Rule helpers (getWaits, tryRon, botDiscard, isNagashi,
// applyOkaUma, ...) are NOT re-exported here — import them from ./helpers,
// which is the single definition shared with the bridge server. What lives only
// in this file is the CLI/plumbing above plus the offline power rig.
module.exports = {
  main,
  selftest,
  parseArgs,
  buildWall,
  countVisible,
  powerDraw,
  POWERS,
};

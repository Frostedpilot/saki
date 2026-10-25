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
//        the next clean discard (demo rare rulings on demand; bypasses detection)
//        [--force-abort=NAME] forces one abortive draw's DETECTION to report
//        true, so main()'s own wiring for it runs (suufon-renda | suukaikan |
//        suucha-riichi | triple-ron)
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
  shantenOf,
  hairiOf,
  getWaits,
  clearTempFuritenOnDraw,
  tryRon,
  botDiscard,
  botWantsCall,
  kuikaeBannedChi,
  distinctYaochuu,
  canRiichi,
  bakazeOf,
  roundLabel,
  clearAllIppatsu,
  ankanKeepsWaits,
  isSuufonRenda,
  isSuukaikanAbort,
  isNagashi,
  applyOkaUma,
} = require('./helpers');
// Shared hand-transition table with server/table.js (KI-04): dealer repeat,
// honba, noten schedule, han floor. Turn order and the per-turn skeleton come
// from hand-driver; this file supplies the CLI adapter (prompts, powerDraw,
// printing).
const MF = require('./match-flow');
// Phase 3 of the turn-loop merge: the pure single-turn rules (own-kan
// availability, call candidates, call priority) shared with server/table.js.
const TC = require('./turn-core');
const HD = require('./hand-driver');
// The deterministic rule checks behind `--selftest=1`, extracted from this file so
// the entry point stays about the match loop (KI-11).
const { selftest } = require('./selftest');
// Tile conservation, wanpai-aware (see invariants.js `wanpaiPartition`). The
// offline loop asserts it after every discard so a drifted hand driver fails
// loudly here instead of printing a plausible-looking likely-bogus match.
const { checkStateConservation } = require('./invariants');

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
    if (m[2] !== undefined) {
      out[key] = m[2];
      continue;
    }
    const next = argv[i + 1];
    // A value is anything that isn't another flag. `-1` is a value, `--x` is not.
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
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
function flagValue(key, example) {
  const v = args[key];
  if (v === undefined) return undefined;
  if (v !== true) return v;
  console.error(`--${key} needs a value, e.g. ${example}`);
  process.exit(1);
}

const rawPowers = flagValue('powers', '--powers none,none,saki,none');
const SEAT_POWERS = (rawPowers === undefined ? 'none,none,none,none' : rawPowers)
  .split(',')
  .concat(['none', 'none', 'none', 'none'])
  .slice(0, 4);
const badPowers = SEAT_POWERS.filter((p) => !POWERS.includes(p));
if (badPowers.length) {
  console.error(`unknown --powers value(s): ${badPowers.join(',')}`);
  console.error(`valid powers: ${POWERS.join(', ')}`);
  process.exit(1);
}
const rawHuman = flagValue('human', '--human 0');
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
// --force-abort=NAME forces one abortive draw's DETECTION to report true, so main()'s
// own wiring for that ruling is exercised: the guard, the accumulator that feeds it
// (firstLapDiscards, fourRiichiPending, kansBy, the ron hits), the state it sets and
// the shared settlement that follows.
//
// This is deliberately NOT the same as --demo-abort. That flag injects the abort *after*
// the detection sites, so it covers the settlement and nothing else -- which is why
// suufon-renda, suukaikan, suucha-riichi and triple ron were unit-tested as predicates
// yet never observed to fire from main() at all. Their conditions are real but rare
// between bots: a 600-seed sweep never produced one. See docs/known-issues.md KI-22.
//
// Names: suufon-renda | suukaikan | suucha-riichi | triple-ron
const FORCE_ABORT = args['force-abort'] || null;
const forced = (name) => FORCE_ABORT === name;

// The two detections that appear at several call sites, factored so --force-abort
// cannot be wired into one site and forgotten at another. suufon-renda and
// suucha-riichi have a single site each and are guarded inline.
const tripleRonAbort = (hits) =>
  MF.abortEnabled(RULES.aborts, 'tripleRon') && (hits.length === 3 || forced('triple-ron'));
const suukaikanAbort = (kansBy) =>
  MF.abortEnabled(RULES.aborts, 'suukaikan') && (isSuukaikanAbort(kansBy) || forced('suukaikan'));
const rawSeed = flagValue('seed', '--seed 42');
if (rawSeed !== undefined) {
  // deterministic RNG for tests (mulberry32 via engine/rng.js)
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
  for (const [five, aka] of [
    ['5m', '0m'],
    ['5p', '0p'],
    ['5s', '0s'],
  ])
    w[w.indexOf(five)] = aka;
  for (let i = w.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [w[i], w[j]] = [w[j], w[i]];
  }
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
// require block at the top). getWaits and the rest used to be duplicated here
// verbatim; isDiscardFuriten is used only by the selftest now (./selftest.js).

// ---------- Saki power draw hook (per seat) ----------
function powerDraw(wall, hand, power, ctx) {
  const drawOne = () => wall.pop();
  if (!wall.length) return null;
  if (power === 'none') return drawOne();
  const base = shantenOf(hand);
  if (power === 'kuro') {
    const win = wall.slice(-8);
    const i = win.findIndex((t) => ctx.dora.includes(norm(t)));
    if (i >= 0 && Math.random() < 0.7) return wall.splice(wall.length - 8 + i, 1)[0];
    return drawOne();
  }
  if (power === 'saki' || power === 'yuuki') {
    if (power === 'yuuki' && ctx.roundWind !== 'E') return drawOne();
    const t = drawOne();
    if (base <= 1 && wall.length && shantenOf([...hand, t].slice(-14)) >= base && Math.random() < 0.55) {
      wall.unshift(t);
      return drawOne();
    }
    return t;
  }
  if (power === 'koromo') {
    if (wall.length <= 10 && base <= 0 && Math.random() < 0.5) {
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      const i = wall.findIndex((t) => waits.includes(norm(t)));
      if (i >= 0) return wall.splice(i, 1)[0];
    }
    return drawOne();
  }
  if (power === 'hisa' && base === 0 && wall.length && Math.random() < 0.25) {
    const h = hairiOf(hand);
    const waits = h && h.wait ? Object.keys(h.wait) : [];
    if (waits.length <= 2) {
      const i = wall.findIndex((x) => waits.includes(norm(x)));
      if (i >= 0) {
        const t = drawOne();
        wall.push(t);
        return wall.splice(i, 1)[0];
      }
    }
  }
  return drawOne();
}

// ---------- bot brain, abort helpers, settlement ----------
// botDiscard, botWantsCall, chiOptions, countYaochuu, isSuufonRenda,
// isSuukaikanAbort, bakazeOf, roundLabel, canRiichi, kuikaeBannedChi,
// ankanKeepsWaits, applyOkaUma, isNagashi, clearAllIppatsu and tryRon all
// moved to ./helpers — one definition each, shared with the bridge server.

// ---------- game ----------
async function main() {
  if (args.selftest !== undefined && args.selftest !== false && (args.selftest === true || args.selftest === '1'))
    return selftest();
  const readline =
    HUMAN >= 0 ? require('readline').createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = (q) => new Promise((res) => readline.question(q, res));
  const scores = [RULES.startScore, RULES.startScore, RULES.startScore, RULES.startScore];
  const names = SEAT_POWERS.map((p, i) => `P${i}(${p})${i === HUMAN ? '[YOU]' : ''}`);
  let dealer = 0,
    honba = 0,
    riichiCarry = 0;
  let demoAbortOnce = DEMO_ABORT; // one-shot for the whole match (else redeal loops forever)
  let safety = 0; // infinite-redeal guard (pathological abort streaks)
  let overtime = false; // enchousen: extra hands past all-last (ryanhan-shibari active)

  for (let kyoku = 0; kyoku < KYOKU_N; kyoku++) {
    if (++safety > KYOKU_N + 50) {
      console.log('SAFETY STOP: too many redeals');
      break;
    }
    const bakaze = bakazeOf(kyoku),
      jikazeOf = (p) => ((p - dealer + 4) % 4) + 1;
    const wallFull = buildWall();
    // dead wall layout: [0..3] rinshan, dora ind dead[4,6,8,10,12], ura dead[5,7,9,11,13]
    const dead = wallFull.splice(0, 14);
    let rinshanIdx = 0,
      kanCount = 0,
      callsMade = 0,
      drawsThisKyoku = 0;
    const kansBy = [0, 0, 0, 0];
    const firstLapDiscards = []; // for suufon-renda (first discard each, no calls)
    let suufonDone = false;
    let fourRiichiPending = false; // set when 4th riichi declared; checked after its discard
    const initialIndicators = MF.doraIndicatorSlots(0);
    const doraInd = [dead[initialIndicators.dora]],
      uraInd = [dead[initialIndicators.ura]];
    const revealKanDora = () => {
      kanCount++;
      const slots = MF.doraIndicatorSlots(kanCount);
      if (slots.revealed) {
        doraInd.push(dead[slots.dora]);
        uraInd.push(dead[slots.ura]);
      }
    };
    const baseDora = () => doraInd.map(DORA_NEXT);
    const ctx = {
      dora: baseDora(),
      bakaze,
      jikaze: 1,
      riichi: false,
      roundWind: bakaze === 1 ? 'E' : 'S',
      riichiPool: riichiCarry,
    };
    riichiCarry = 0;
    const P = [0, 1, 2, 3].map((i) => ({
      id: i,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      tempFuriten: false,
      power: SEAT_POWERS[i],
    }));
    for (let k = 0; k < 13; k++) for (let i = 0; i < 4; i++) P[(dealer + i) % 4].hand.push(wallFull.pop());
    // hand-driver reads these as ctx.players / ctx.drawsThisKyoku / ctx.callsMade /
    // ctx.kanCount / ctx.rinshanIdx. Accessors keep the driver and the CLI's own
    // helpers reading and writing the same counters.
    Object.defineProperties(ctx, {
      players: { get: () => P },
      drawsThisKyoku: {
        get: () => drawsThisKyoku,
        set: (v) => {
          drawsThisKyoku = v;
        },
      },
      callsMade: {
        get: () => callsMade,
        set: (v) => {
          callsMade = v;
        },
      },
      kanCount: {
        get: () => kanCount,
        set: (v) => {
          kanCount = v;
        },
      },
      rinshanIdx: {
        get: () => rinshanIdx,
        set: (v) => {
          rinshanIdx = v;
        },
      },
    });
    const sortH = (h) => h.sort((a, b) => (norm(a) < norm(b) ? -1 : 1));
    P.forEach((p) => sortH(p.hand));
    // Conservation guard for the whole hand. `rinshanIdx` marks how many wanpai
    // slots have been drawn out of `dead` (those tiles now live in a hand), so
    // only `dead.slice(rinshanIdx)` is still on the table — counting the whole
    // array double-counts every rinshan tile. See invariants.js.
    const assertConserved = (where) => {
      const problems = checkStateConservation(P, wallFull, dead, rinshanIdx);
      if (problems.length) throw new Error(`tile conservation broke ${where}: ${problems.join('; ')}`);
    };
    assertConserved('after the deal');
    console.log(
      `\n=== ${roundLabel(kyoku)}${overtime ? ' ENCHOUSEN' : ''} dealer=${names[dealer]} honba=${honba} dora=${doraInd}(${ctx.dora}) scores=${scores.join('/')} ===`
    );
    // --- kyuushu-kyuuhai: 9+ DISTINCT terminals/honors may abort the deal ---
    // The gate counts distinct KINDS, not tiles. It used to count tiles, which let a
    // hand like 1111m 1111p 99s (nine tiles, three kinds) through — and the bot branch
    // then declared on `distinct < 9`, i.e. precisely when the abort was illegal. See
    // docs/known-issues.md KI-22.
    // declarer chooses: abortive draw (same dealer replay, honba+1) or play on.
    let kyuushuAbort = false;
    // Gated by RULES.aborts.kyuushuKyuuhai: when off, the loop never runs and the
    // deal simply plays on (the same shape as a declarer who chooses to play on).
    for (let k = 0; k < 4 && !kyuushuAbort && MF.abortEnabled(RULES.aborts, 'kyuushuKyuuhai'); k++) {
      const q = (dealer + k) % 4;
      const terms = distinctYaochuu(P[q].hand);
      if (terms >= 9) {
        let declare;
        if (P[q].id === HUMAN) {
          console.log(`  YOUR dealt hand: ${P[q].hand.join(' ')} (${terms} distinct terminals/honors)`);
          const a = (await ask('  declare KYUUSHU-KYUUHAI abortive draw, or play on? (abort/play): '))
            .trim()
            .toLowerCase();
          declare = a.startsWith('abort') || a === 'a' || a === 'y';
        } else {
          // Reaching this branch means the declaration is legal; now it is only a
          // question of whether the bot wants it. Kept at the original 0.8 — bot
          // policy is a judgement call, and the bug here was legality, not taste.
          declare = Math.random() < 0.8;
        }
        if (declare) {
          console.log(`  ${names[q]} declares KYUUSHU-KYUUHAI (${terms} distinct yaochuuhai) - abortive draw`);
          kyuushuAbort = true;
        } else console.log(`  ${names[q]} holds ${terms} distinct terminals/honors but plays on`);
      }
    }
    if (kyuushuAbort) {
      honba++;
      riichiCarry = ctx.riichiPool; // sticks stay on the table for the redeal
      console.log(`scores unchanged: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry}) - redeal, same dealer`);
      kyoku--; // replay same kyoku number
      continue; // skips dealer rotation: same dealer redeals
    }
    let winner,
      winBy,
      draws = 0;
    let demoAbort = demoAbortOnce;
    demoAbortOnce = null;
    const allLast = kyoku === KYOKU_N - 1;
    const minHan = MF.minHan(overtime); // ryanhan-shibari during enchousen
    if (overtime) console.log('  ryanhan-shibari: wins need 2+ han');

    const declareRiichi = (pl, firstClass, locked13) => {
      pl.riichi = true;
      pl.doubleRiichi = firstClass;
      pl.ippatsu = true; // expires on any call or on declarer's NEXT discard
      pl.ippatsuJustDeclared = true; // the declaring discard itself must not clear it
      scores[pl.id] -= RULES.riichiValue;
      ctx.riichiPool += RULES.riichiValue;
      // snapshot waits: later ankans must not change them (else chombo)
      pl.riichiWaits = locked13
        ? getWaits({ hand: [...locked13], melds: [] }, P, dead, { dora: [], bakaze, jikaze: 1 })
        : [];
      console.log(`  ${names[pl.id]} ${firstClass ? 'DOUBLE RIICHI' : 'RIICHI'}`);
      if (MF.abortEnabled(RULES.aborts, 'suuchaRiichi') && (P.every((p) => p.riichi) || forced('suucha-riichi'))) {
        fourRiichiPending = true; // abort after this discard unless someone rons it
        console.log(
          `  SUUCHA-RIICHI: all four riichi${forced('suucha-riichi') && !P.every((p) => p.riichi) ? ' (FORCED via --force-abort, not actually all four)' : ''}`
        );
      }
    };
    // Double-riichi eligibility uses the same first-draw window as tenhou
    // (shared in turn-core.beginTurn), instead of a local calls/draws copy.
    const isFirstTurn = (pl) => TC.beginTurn(pl, { callsMade, drawsThisKyoku, wallLeft: wallFull.length }).firstDraw;
    // Ron collection: EVERY eligible player wins (double ron), furiten
    // enforced, human prompted per seat, turn-ordered. 3 winners = triple
    // ron (caller handles as abortive draw). flags: {houtei, chankan, label}
    //
    // Detection is shared with the server (turn-core.callCandidates); this
    // function only owns the CLI prompt and the temp-furiten consequence of
    // declining.
    async function collectRon(tile, fromTurn, flags = {}) {
      const hits = [];
      const candidates = TC.callCandidates({
        from: fromTurn,
        tile,
        players: P,
        dead,
        scoreCtxFor: (q) => ({
          dora: baseDora(),
          bakaze,
          jikaze: jikazeOf(q),
          riichi: P[q].riichi,
          doubleRiichi: P[q].doubleRiichi,
          ippatsu: P[q].ippatsu,
          kanFlag: !!flags.chankan,
          lastFlag: !!flags.houtei,
          tenhou: false,
        }),
        minHan: flags.minHan || 1,
        chankan: !!flags.chankan,
        kanCount,
        rinshanIdx,
      });
      for (const c of candidates) {
        const q = c.seat;
        const qp = c.qp;
        if (c.ron) {
          if (qp.id === HUMAN) {
            console.log(
              `  ${flags.label || 'RON'} available on ${tile}: ${c.ron.r.text} ${JSON.stringify(c.ron.r.yaku)}`
            );
            const a = (await ask(`  ${flags.label || 'ron'}? (y/n): `)).trim();
            if (!a.toLowerCase().startsWith('y')) {
              qp.tempFuriten = true;
              continue;
            }
          }
          hits.push({ seat: q });
        } else if (c.ronBlocked) {
          console.log(`  ${names[q]} FURITEN (${c.ronBlocked.reason}) - ron on ${tile} blocked`);
        }
      }
      return hits;
    }
    function ronWinResultMulti(hits, from, tile, flags = {}) {
      const wins = hits.map((h) => ({
        seat: h.seat,
        r: rescore(P[h.seat], P[h.seat].hand, P[h.seat].melds, tile, false, {
          bakaze,
          jikaze: jikazeOf(h.seat),
          riichi: P[h.seat].riichi,
          doubleRiichi: P[h.seat].doubleRiichi,
          ippatsu: P[h.seat].ippatsu,
          kanFlag: !!flags.chankan,
          lastFlag: !!flags.houtei,
          tenhou: false,
        }),
      }));
      const tag = [
        flags.chankan && (flags.label || 'CHANKAN'),
        flags.houtei && 'HOUTEI',
        wins.some((w) => P[w.seat].ippatsu) && 'IPPATSU',
        wins.length > 1 && 'DOUBLE RON',
      ]
        .filter(Boolean)
        .join(' ');
      return { type: 'ron', from, wins, tile, tag };
    }

    // ---- CLI adapter for the shared hand/turn driver (engine/hand-driver.js) ----
    // hand-driver owns turn order and the draw → tsumo/kan/riichi/discard →
    // call-window skeleton. The CLI owns the prompts, its draw model (powerDraw)
    // and the settlement/printing shape, so those live here.
    let pendingRiichiLocked13 = null;
    let pendingDiscardIndex = null;
    const cliDeclareRiichi = declareRiichi;

    // Discard choice shared by the normal draw path and the post-kan path: pick
    // a tile, and offer riichi when the shape allows it. The riichi declaration
    // itself runs from the adapter, before the tile leaves the hand.
    async function cliChooseDiscard(seat) {
      const me = P[seat];
      let di;
      let declare = false;
      let riichiFirst = false;
      if (me.id === HUMAN) {
        console.log(
          `  YOUR hand(${me.hand.length}): ${me.hand.join(' ')} shanten=${shantenOf(me.hand)} dora=${ctx.dora}`
        );
        // Waits/furiten are a 13-tile property. The hand here holds the drawn
        // tile (14), so score the concealed hand WITHOUT it — passing 14 tiles
        // to getWaits made it test a 15-tile agari, which never exists, so the
        // furiten warning below could never fire (it was effectively dead).
        const concealed13 = me.hand.filter((_, i) => i !== me.hand.length - 1);
        const h = hairiOf(concealed13);
        if (h && h.now !== undefined) console.log(`  hairi now=${h.now}`);
        const myWaits = getWaits({ ...me, hand: concealed13 }, P, dead, { dora: [], bakaze, jikaze: 1 });
        if (myWaits.length && me.discards.some((d) => myWaits.includes(norm(d))))
          console.log('  *** YOU ARE FURITEN (ron blocked) ***');
        const a = (await ask('  discard? (tile or index): ')).trim();
        di = parseDiscardIndex(a, me.hand);
        if (!me.riichi && me.melds.every((m) => !m.open) && shantenOf(me.hand.filter((_, i) => i !== di)) === 0) {
          const q = (await ask('  declare riichi? (y/n): ')).trim();
          if (q.toLowerCase().startsWith('y') && canRiichi(scores[seat], wallFull.length)) {
            declare = true;
            riichiFirst = isFirstTurn(me);
            pendingRiichiLocked13 = me.hand.filter((_, i) => i !== di);
          } else if (q.toLowerCase().startsWith('y')) console.log('  riichi denied (need 1000pts + 4 wall tiles)');
        }
      } else {
        // single discard choice reused for the riichi test AND the cut
        // (two separate botDiscard calls could disagree under epsilon-random
        // and declare riichi on a non-tenpai hand)
        di = botDiscard(me.hand, me.riichi);
        if (!me.riichi && me.melds.every((m) => !m.open)) {
          if (shantenOf(me.hand.filter((_, i) => i !== di)) === 0 && canRiichi(scores[seat], wallFull.length)) {
            const riichiP = RIICHI_ALWAYS ? 1 : 0.45;
            if (Math.random() < riichiP) {
              declare = true;
              riichiFirst = isFirstTurn(me);
              pendingRiichiLocked13 = me.hand.filter((_, i) => i !== di);
            }
          }
        }
      }
      return { tile: me.hand[di], index: di, declare, riichiFirst };
    }

    // The discard + call window for a turn that already drew (the rinshan tile
    // after a kan). The normal draw path reaches the same two adapter methods
    // through hand-driver.playTurn.
    async function cliFinishDiscard(seat) {
      const pick = await cliChooseDiscard(seat);
      pendingDiscardIndex = pick.index;
      if (pick.declare) cliAdapter.declareRiichi(seat, pick.riichiFirst);
      const disc = cliAdapter.executeDiscard(seat, pick.tile);
      if (disc && disc.error) return cliAdapter.onDiscardError(seat, disc.error);
      return cliAdapter.resolveCallWindow(seat, disc.tile, { houtei: wallFull.length === 0 });
    }

    const cliAdapter = {
      ctx,

      startTurn(seat) {
        draws++;
        ctx.jikaze = jikazeOf(seat);
        return 0;
      },

      onTurnStart() {},

      wallLeft: () => wallFull.length,

      drawTurn(seat) {
        const me = P[seat];
        const t = powerDraw(wallFull, me.hand, me.power, ctx);
        if (!t) return null;
        me.hand.push(t);
        return t;
      },

      onWallExhausted() {
        // powerDraw ran dry: the old loop simply stopped drawing.
        return { end: true, winner: -1, winBy: null };
      },

      scoreFor(seat, drawn, flags) {
        const me = P[seat];
        return scoreHand(me.hand, me.melds, drawn, true, {
          dora: baseDora(),
          bakaze,
          jikaze: jikazeOf(seat),
          riichi: me.riichi,
          doubleRiichi: me.doubleRiichi,
          ippatsu: me.ippatsu,
          kanFlag: false,
          lastFlag: !!flags.last,
          tenhou: !!flags.tenhou,
        });
      },

      isAWin(r) {
        return !!(r && r.isAgari && (r.yakuman > 0 || r.han >= 1));
      },

      winMeetsFloor(r) {
        return !!(r && (r.yakuman > 0 || r.han >= minHan));
      },

      tsumoBlockReason() {
        return null; // the CLI only logs the overtime floor, in chooseTurnAction
      },

      emitDraw() {},

      async chooseTurnAction(seat, { tsumoScore, wantTsumo, kan }) {
        const me = P[seat];
        const ankanTile = kan.ankanTile;
        const ponUp = kan.ponUp;
        let kanChoice = null; // {kind:'ankan'|'kakan', tile}
        if (kan.canKan) {
          if (me.id === HUMAN) {
            if (ankanTile || ponUp) {
              console.log(`  YOUR hand: ${me.hand.join(' ')} melds=${JSON.stringify(me.melds.map(meldStr))}`);
              const a = (
                await ask(
                  `  declare KAN? (${[ankanTile && 'ankan ' + ankanTile, ponUp && 'kakan ' + norm(ponUp.tiles[0])].filter(Boolean).join('/')} / n): `
                )
              )
                .trim()
                .toLowerCase();
              if (a.startsWith('ankan') && ankanTile) {
                if (me.riichi && !ankanKeepsWaits(me, ankanTile)) {
                  console.log('  WARNING: this ankan changes your riichi waits = CHOMBO (mangan penalty).');
                  const c = (await ask('  declare anyway? (y/n): ')).trim().toLowerCase();
                  if (c.startsWith('y')) kanChoice = { kind: 'ankan', tile: ankanTile, chombo: true };
                } else kanChoice = { kind: 'ankan', tile: ankanTile };
              } else if (a.startsWith('kakan') && ponUp) {
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
            } else if (ponUp && Math.random() < 0.35) {
              // bots never chombo: no kakan while in riichi (see above)
              if (me.riichi) console.log(`  ${names[me.id]} skips KAKAN (illegal while in riichi)`);
              else kanChoice = { kind: 'kakan', tile: norm(ponUp.tiles[0]) };
            }
          }
        }
        if (kanChoice) return { type: 'Kan', kan: kanChoice };

        if (wantTsumo) {
          let declare = true;
          if (me.id === HUMAN) {
            console.log(`  YOUR hand: ${me.hand.join(' ')} melds=${JSON.stringify(me.melds.map(meldStr))}`);
            console.log(
              `  TSUMO available: ${tsumoScore.text} ${JSON.stringify(tsumoScore.yaku)} ten=${tsumoScore.ten}`
            );
            const a = (await ask('  tsumo? (y/n): ')).trim();
            declare = a.toLowerCase().startsWith('y');
          }
          if (declare) return { type: 'Tsumo' };
        } else if (me.id === HUMAN && tsumoScore && tsumoScore.isAgari && tsumoScore.han > 0) {
          console.log('  shibari: tsumo under 2 han - passing');
        }

        const pick = await cliChooseDiscard(seat);
        pendingDiscardIndex = pick.index;
        if (pick.declare) return { type: 'Riichi', tile: pick.tile, riichiFirst: pick.riichiFirst };
        return { type: 'Discard', tile: pick.tile };
      },

      onTsumo(seat, { turnStart }) {
        return { end: true, winner: seat, winBy: tsumoWin(P[seat], seat, null, false, turnStart.isLastDraw) };
      },

      onInvalidTsumo(seat) {
        // The CLI asks before returning Tsumo, so this is unreachable; keep the
        // server's safety shape rather than inventing a new terminal.
        return { end: true, winner: seat, winBy: null };
      },

      onDiscardError(seat, reason) {
        console.log(`  invalid discard for ${names[seat]}: ${reason}`);
        return { end: true, winner: -1, winBy: null };
      },

      async doOwnKan(seat, me, kan) {
        // An ankan after riichi that changes the waits is a chombo: the original
        // loop broke before moving any tiles, so do not apply the kan here.
        if (kan.chombo) return { end: true, winner: -3, winBy: { type: 'chombo', offender: seat } };

        const turn = seat;
        const kt = kan.tile;
        if (kan.kind === 'kakan') {
          // CHANKAN check before meld upgrade (furiten applies, multi-ron possible)
          const ckHits = await collectRon(kt, turn, { chankan: true, label: 'CHANKAN', minHan });
          if (tripleRonAbort(ckHits)) {
            return { end: true, winner: -2, winBy: { type: 'abort', reason: `TRIPLE RON (chankan) on ${kt}` } };
          }
          if (ckHits.length > 0) {
            return {
              end: true,
              winner: ckHits[0].seat,
              winBy: ronWinResultMulti(ckHits, turn, kt, {
                chankan: true,
                label: `CHANKAN ${names[turn]} kakan ${kt}`,
              }),
            };
          }
          const pm = me.melds.find((m) => m.type === 'pon' && same(m.tiles[0], kt));
          const i = me.hand.findIndex((x) => same(x, kt));
          pm.tiles.push(me.hand.splice(i, 1)[0]);
          pm.type = 'kakan';
          console.log(`  ${names[turn]} KAKAN ${kt}`);
        } else {
          // closed kan: kokushi-only chankan exception
          let ckWin = -1,
            ckR = null;
          for (let k = 1; k <= 3; k++) {
            const q = (turn + k) % 4;
            const qp = P[q];
            if (!qp.hand.length || qp.melds.length) continue;
            const cs = {
              dora: baseDora(),
              bakaze,
              jikaze: jikazeOf(q),
              riichi: qp.riichi,
              doubleRiichi: qp.doubleRiichi,
              ippatsu: qp.ippatsu,
              kanFlag: true,
              lastFlag: false,
              tenhou: false,
            };
            const att = tryRon(qp, kt, cs, P, dead, { chankan: true });
            if (att.win && att.r.yaku['国士無双'] !== undefined) {
              ckWin = q;
              ckR = att.r;
              break;
            }
          }
          if (ckWin >= 0) {
            return {
              end: true,
              winner: ckWin,
              winBy: chankanWin(P[ckWin], ckWin, turn, kt, ckR, `CHANKAN (kokushi) on ANKAN ${kt}`),
            };
          }
          const tiles = [];
          for (let c = 0; c < 4; c++) {
            const i = me.hand.findIndex((x) => same(x, kt));
            tiles.push(me.hand.splice(i, 1)[0]);
          }
          me.melds.push({ tiles, open: false, type: 'kan' });
          console.log(`  ${names[turn]} CLOSED KAN ${kt}`);
        }
        revealKanDora();
        ctx.dora = baseDora();
        console.log(`  new dora=${ctx.dora}`);
        callsMade++;
        clearAllIppatsu(P);
        kansBy[turn]++;
        if (suukaikanAbort(kansBy)) {
          return {
            end: true,
            winner: -2,
            winBy: { type: 'abort', reason: `SUUKAIKAN (four kans: ${kansBy.join('/')})` },
          };
        }
        if (kanCount >= RULES.maxKan) console.log('  four kans by one player - play continues');
        if (rinshanIdx >= RULES.rinshanSlots) {
          console.log('  no rinshan tiles left');
          return { end: false, next: turn }; // redraw from the wall on the next turn
        }
        const rt = dead[rinshanIdx++];
        me.hand.push(rt);
        clearTempFuritenOnDraw(me); // a rinshan draw is still your own draw
        console.log(`  ${names[turn]} rinshan draw ${rt}`);
        ctx.jikaze = jikazeOf(turn);
        const trs = scoreHand(me.hand, me.melds, rt, true, {
          dora: baseDora(),
          bakaze,
          jikaze: jikazeOf(turn),
          riichi: me.riichi,
          doubleRiichi: me.doubleRiichi,
          ippatsu: me.ippatsu,
          kanFlag: true,
          lastFlag: false,
          tenhou: false,
        });
        if (trs.isAgari && (trs.yakuman > 0 || trs.han >= minHan)) {
          return { end: true, winner: turn, winBy: tsumoWin(me, turn, trs, true, false) };
        }
        if (overtime && trs.isAgari && trs.han > 0 && me.id === HUMAN)
          console.log('  shibari: rinshan win under 2 han - passing');
        // no rinshan win -> must discard from the current hand
        return cliFinishDiscard(seat);
      },

      declareRiichi(seat, riichiFirst) {
        const locked13 = pendingRiichiLocked13;
        pendingRiichiLocked13 = null;
        cliDeclareRiichi(P[seat], riichiFirst, locked13);
      },

      executeDiscard(seat, tile) {
        const me = P[seat];
        // Preserve the exact tile instance the chooser picked. Two tiles with
        // the same code (or a red five and a normal five) are different hand
        // elements; removing a different copy would reorder the hand and change
        // the next botDiscard's index-based choice.
        const di =
          Number.isInteger(pendingDiscardIndex) && me.hand[pendingDiscardIndex] === tile
            ? pendingDiscardIndex
            : me.hand.indexOf(tile);
        pendingDiscardIndex = null;
        if (di < 0) return { error: `tile ${tile} is not in the hand` };
        const disc = me.hand.splice(di, 1)[0];
        me.discards.push(disc);
        assertConserved(`after ${names[seat]} discarded ${disc}`);
        // Ippatsu survives the declaring discard and expires on the declarer's
        // next discard (or on any call via clearAllIppatsu); first-lap tracking
        // is shared with the server.
        const discard = TC.resolveDiscard({
          callsMade,
          suufonDone,
          discardsCount: me.discards.length,
          ippatsu: me.ippatsu,
          ippatsuJustDeclared: me.ippatsuJustDeclared,
        });
        me.ippatsu = discard.ippatsu;
        me.ippatsuJustDeclared = discard.ippatsuJustDeclared;
        if (draws % 8 === 0 || me.riichi)
          console.log(
            `  ${names[seat]} discard ${disc} (sh=${shantenOf(me.hand)}) discards:${me.discards.slice(-6).join('')}`
          );
        else console.log(`  ${names[seat]} cut ${disc} (sh=${shantenOf(me.hand)})`);
        // suufon-renda tracking: first discard of each seat while no call made yet
        if (discard.firstLap) firstLapDiscards.push(disc);
        return { tile: disc };
      },

      afterDiscard() {},

      // Everything after a discard leaves the hand: ron, abortive draws, the
      // pon/daiminkan/chi window and suufon-renda. Returns a terminal turn
      // result, a next-seat result after a call, or null for a quiet discard.
      async resolveCallWindow(seat, tile, { houtei } = {}) {
        const disc = tile;
        const isHoutei = !!houtei;
        const hits = await collectRon(disc, seat, { houtei: isHoutei, minHan });
        if (tripleRonAbort(hits)) {
          return { end: true, winner: -2, winBy: { type: 'abort', reason: `TRIPLE RON on ${disc}` } };
        }
        if (hits.length > 0) {
          return {
            end: true,
            winner: hits[0].seat,
            winBy: ronWinResultMulti(hits, seat, disc, { houtei: isHoutei }),
          };
        }
        // no ron on this discard: abortive draws trigger here (wins take precedence)
        if (fourRiichiPending) {
          return {
            end: true,
            winner: -2,
            winBy: { type: 'abort', reason: 'SUUCHA-RIICHI (four riichi, 4th discard unclaimed)' },
          };
        }
        if (demoAbort) return { end: true, winner: -2, winBy: { type: 'abort', reason: demoAbort } };

        // --- pon / daiminkan / chi (break ippatsu for everyone) ---
        // Candidate detection is shared with the server (turn-core.js): riichi
        // seats cannot call, a daiminkan needs three copies and kan budget, and
        // chi is shimocha-only. Ron was already resolved above, so skip it here.
        const callOptions = TC.callCandidates({
          from: seat,
          tile: disc,
          players: P,
          dead,
          ron: false,
          canOpen: (q, qp) => !CLOSED_ONLY || qp.id === HUMAN,
          kanCount,
          rinshanIdx,
        });
        const me = P[seat];
        for (const c of callOptions) {
          if (!c.pon) continue;
          const q = c.seat;
          let removed = 0;
          const tmp = [...P[q].hand];
          for (const x of [...tmp]) {
            if (same(x, disc) && removed < 2) {
              tmp.splice(tmp.indexOf(x), 1);
              removed++;
            }
          }
          const gain = shantenOf(P[q].hand) - shantenOf(tmp);
          // choice: 'kan' | 'pon' | null
          let choice = null;
          if (P[q].id === HUMAN) {
            const a = c.daiminkan
              ? (await ask(`  ${disc} KAN / PON / pass? (k/p/n): `)).trim().toLowerCase()
              : (await ask(`  ${disc} PON? (y/n): `)).trim().toLowerCase();
            choice =
              (a === 'k' || a === 'kan') && c.daiminkan ? 'kan' : a === 'y' || a === 'p' || a === 'pon' ? 'pon' : null;
          } else if (c.daiminkan && Math.random() < 0.25) {
            choice = 'kan';
          } else if (botWantsCall(gain, CLOSED_ONLY)) {
            choice = 'pon';
          }
          if (choice === 'kan') {
            const tiles = [];
            for (let cc = 0; cc < 3; cc++) {
              const i = P[q].hand.findIndex((x) => same(x, disc));
              tiles.push(P[q].hand.splice(i, 1)[0]);
            }
            tiles.push(disc);
            me.discards.pop();
            P[q].melds.push({ tiles, open: true, type: 'kan' });
            console.log(`  ${names[q]} DAIMINKAN ${disc}`);
            callsMade++;
            clearAllIppatsu(P);
            kansBy[q]++;
            if (suukaikanAbort(kansBy)) {
              return {
                end: true,
                winner: -2,
                winBy: { type: 'abort', reason: `SUUKAIKAN (four kans: ${kansBy.join('/')})` },
              };
            }
            revealKanDora();
            ctx.dora = baseDora();
            console.log(`  new dora=${ctx.dora}`);
            if (rinshanIdx < RULES.rinshanSlots) {
              const rt = dead[rinshanIdx++];
              P[q].hand.push(rt);
              clearTempFuritenOnDraw(P[q]); // a rinshan draw is still your own draw
              console.log(`  ${names[q]} rinshan draw ${rt}`);
              ctx.jikaze = jikazeOf(q);
              const trs = scoreHand(P[q].hand, P[q].melds, rt, true, {
                dora: baseDora(),
                bakaze,
                jikaze: jikazeOf(q),
                riichi: false,
                doubleRiichi: false,
                ippatsu: false,
                kanFlag: true,
                lastFlag: false,
                tenhou: false,
              });
              if (trs.isAgari && (trs.yakuman > 0 || trs.han >= minHan)) {
                return { end: true, winner: q, winBy: tsumoWin(P[q], q, trs, true, false) };
              }
            } else console.log('  no rinshan tiles left');
            const dc = await discardAfterCall(P[q], q, jikazeOf, ask);
            const hitsD = await collectRon(dc, q, { houtei: wallFull.length === 0, minHan });
            if (tripleRonAbort(hitsD)) {
              return { end: true, winner: -2, winBy: { type: 'abort', reason: `TRIPLE RON on ${dc}` } };
            }
            if (hitsD.length > 0) {
              return {
                end: true,
                winner: hitsD[0].seat,
                winBy: ronWinResultMulti(hitsD, q, dc, { houtei: wallFull.length === 0 }),
              };
            }
            return { end: false, next: (q + 1) % 4 };
          } else if (choice === 'pon') {
            const tiles = [];
            for (let cc = 0; cc < 2; cc++) {
              const i = P[q].hand.findIndex((x) => same(x, disc));
              tiles.push(P[q].hand.splice(i, 1)[0]);
            }
            tiles.push(disc);
            me.discards.pop();
            P[q].melds.push({ tiles, open: true, type: 'pon' });
            console.log(`  ${names[q]} PON ${disc}`);
            callsMade++;
            clearAllIppatsu(P);
            const dc = await discardAfterCall(P[q], q, jikazeOf, ask, [norm(tiles[0])]); // kuikae: no 4th tile
            const hitsQ = await collectRon(dc, q, { houtei: wallFull.length === 0, minHan });
            if (tripleRonAbort(hitsQ)) {
              return { end: true, winner: -2, winBy: { type: 'abort', reason: `TRIPLE RON on ${dc}` } };
            }
            if (hitsQ.length > 0) {
              return {
                end: true,
                winner: hitsQ[0].seat,
                winBy: ronWinResultMulti(hitsQ, q, dc, { houtei: wallFull.length === 0 }),
              };
            }
            return { end: false, next: (q + 1) % 4 };
          }
        }

        const nx = (seat + 1) % 4;
        const chiCand = callOptions.find((c) => c.seat === nx && c.chi);
        if (chiCand) {
          const opts = chiCand.chi;
          let doIt = P[nx].id === HUMAN ? null : !CLOSED_ONLY && Math.random() < 0.35;
          if (P[nx].id === HUMAN) {
            const a = (await ask(`  ${disc} CHI ${opts.map((o) => o.join('+')).join('/')}? (y/n): `)).trim();
            doIt = a.toLowerCase().startsWith('y');
          }
          if (doIt) {
            const o = opts[Math.floor(Math.random() * opts.length)];
            const tiles = [disc];
            for (const nn of o) {
              const i = P[nx].hand.findIndex((x) => norm(x) === nn + norm(disc)[1]);
              tiles.push(P[nx].hand.splice(i, 1)[0]);
            }
            me.discards.pop();
            P[nx].melds.push({ tiles, open: true, type: 'chi' });
            console.log(`  ${names[nx]} CHI ${disc} [${o}]`);
            callsMade++;
            clearAllIppatsu(P);
            const dc = await discardAfterCall(P[nx], nx, jikazeOf, ask, kuikaeBannedChi(tiles[1], tiles[2]));
            const hitsX = await collectRon(dc, nx, { houtei: wallFull.length === 0, minHan });
            if (tripleRonAbort(hitsX)) {
              return { end: true, winner: -2, winBy: { type: 'abort', reason: `TRIPLE RON on ${dc}` } };
            }
            if (hitsX.length > 0) {
              return {
                end: true,
                winner: hitsX[0].seat,
                winBy: ronWinResultMulti(hitsX, nx, dc, { houtei: wallFull.length === 0 }),
              };
            }
            return { end: false, next: (nx + 1) % 4 };
          }
        }

        // Suufon-renda: the first four discards are one wind AND nobody called.
        // Checked after the whole call window, not before it: a call on the 4th
        // first-lap discard voids the abort (the accumulator itself only records
        // while `callsMade === 0`). Ron has already taken precedence above.
        if (!suufonDone && callsMade === 0 && firstLapDiscards.length === 4) {
          suufonDone = true;
          // Forced: the guard above still has to be satisfied for real, so this reaches
          // the site through the genuine first-lap accumulator and only overrides the
          // content test.
          if (
            MF.abortEnabled(RULES.aborts, 'suufonRenda') &&
            (isSuufonRenda(firstLapDiscards) || forced('suufon-renda'))
          ) {
            return {
              end: true,
              winner: -2,
              winBy: { type: 'abort', reason: `SUUFON-RENDA (${firstLapDiscards.join(' ')})` },
            };
          }
        }
        return null;
      },

      checkKyuushu: () => -1, // the CLI resolves kyuushu-kyuuhai before the hand loop
      abortKyuushu: () => ({ aborted: true }),
      dealer: () => dealer,
      playTurn: (seat) => HD.playTurn(cliAdapter, seat),
      settle: (w, wb) => ({ winner: w, winBy: wb }),
    };

    const handResult = await HD.playHand(cliAdapter, { maxTurns: 200 });
    winner = handResult.winner;
    winBy = handResult.winBy;

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
      // Tenhou/chihou eligibility is a single definition: closed first-draw
      // win with no calls having been made. The payment must use the same
      // test as the draw-time eligibility (turn-core.beginTurn), not a looser
      // copy that tolerates a meld or a call.
      const tenhouEligible =
        TC.beginTurn(pl, {
          callsMade,
          drawsThisKyoku,
          wallLeft: wallFull.length,
        }).firstDraw && !rinshan;
      const r = rescore(pl, pl.hand, pl.melds, null, true, {
        bakaze,
        jikaze: jikazeOf(seat),
        riichi: pl.riichi,
        doubleRiichi: pl.doubleRiichi,
        ippatsu: pl.ippatsu,
        kanFlag: rinshan,
        lastFlag: haitei,
        tenhou: tenhouEligible ? true : false,
      });
      const tag = [rinshan && 'RINSHAN', haitei && 'HAITEI', pl.ippatsu && 'IPPATSU', pl.doubleRiichi && 'W-RIICHI']
        .filter(Boolean)
        .join(' ');
      return { type: 'tsumo', r, tag };
    }
    function chankanWin(pl, seat, from, tile, r0, label) {
      const r = rescore(pl, pl.hand, pl.melds, tile, false, {
        bakaze,
        jikaze: jikazeOf(seat),
        riichi: pl.riichi,
        doubleRiichi: pl.doubleRiichi,
        ippatsu: pl.ippatsu,
        kanFlag: true,
        lastFlag: false,
        tenhou: false,
      });
      return { type: 'ron', from, r, tile, tag: label };
    }
    async function discardAfterCall(pl, seat, jikazeOfFn, askFn, banned = []) {
      ctx.jikaze = jikazeOfFn(seat);
      const isBanned = (t) => banned.includes(norm(t));
      let dc;
      if (pl.id === HUMAN) {
        for (;;) {
          console.log(`  YOUR hand: ${pl.hand.join(' ')}`);
          const a = (
            await askFn(`  discard after call?${banned.length ? ` (kuikae ban: ${banned.join(' ')})` : ''} `)
          ).trim();
          let d2 = pl.hand.findIndex((x) => x === a || norm(x) === a);
          if (d2 < 0) d2 = pl.hand.length - 1;
          if (isBanned(pl.hand[d2])) {
            console.log('  kuikae: that discard is illegal after your call - choose another.');
            continue;
          }
          dc = pl.hand.splice(d2, 1)[0];
          break;
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
    // Apply a shared hand transition (match-flow.js handOutcome), which is pure
    // policy: it returns the next honba/kyoku/dealer movement and never mutates
    // counters itself. Match-END policy (tobi/agari-yame/overtime) stays below.
    const applyFlow = (flow) => {
      if (flow.honba === 'increment') honba++;
      else if (flow.honba === 'reset') honba = 0;
      // 'keep' (chombo) leaves honba unchanged.
      if (flow.kyokuRepeat) kyoku--;
      keepDealer = flow.keepDealer;
    };
    if (winBy && winBy.type === 'chombo') {
      const o = winBy.offender;
      console.log(`\n*** CHOMBO ${names[o]} (illegal ankan after riichi) - mangan penalty, replay ***`);
      // Chombo penalty: the offender pays every other seat a mangan tsumo.
      // Shared pairwise rule (match-flow.js); honba is deliberately ignored.
      for (let i = 0; i < 4; i++)
        if (i !== o) {
          const c = MF.manganPayment(o, i, dealer);
          scores[i] += c;
          scores[o] -= c;
        }
      riichiCarry = ctx.riichiPool; // sticks stay on the table
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry})`);
      applyFlow(MF.handOutcome({ kind: 'chombo', dealer }));
    } else if (winBy && winBy.type === 'abort') {
      console.log(`\n*** ABORTIVE DRAW (${winBy.reason}) ***`);
      riichiCarry = ctx.riichiPool;
      applyFlow(MF.handOutcome({ kind: 'abort', dealer }));
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry}) - redeal, same dealer`);
    } else if (winner >= 0) {
      const winnerSeats = winBy.type === 'tsumo' ? [winner] : winBy.wins.map((w) => w.seat);
      const dealerWon = MF.dealerWonOnWin(winBy.type, winnerSeats, dealer);
      if (winBy.type === 'tsumo') {
        const r = winBy.r;
        console.log(
          `\n*** TSUMO ${names[winner]} ${winBy.tag || ''} ${r.text} ${JSON.stringify(r.yaku)} ten=${r.ten} ***`
        );
        // Shared score arithmetic (match-flow.js winPayments).
        const { deltas } = MF.winPayments({ type: 'tsumo', winner, dealer, honba, result: r });
        for (let i = 0; i < 4; i++) scores[i] += deltas[i];
        scores[winner] += ctx.riichiPool;
        ctx.riichiPool = 0;
      } else {
        // ron: single or double. Discarder pays each winner; sticks go to
        // the winner nearest in turn order (wins[0]).
        console.log(
          `\n*** ${winBy.wins.length > 1 ? 'DOUBLE ' : ''}RON on ${winBy.tile} from ${names[winBy.from]} ${winBy.tag || ''} ***`
        );
        for (const w of winBy.wins) {
          const { deltas, pay } = MF.winPayments({
            type: 'ron',
            winner: w.seat,
            dealer,
            honba,
            result: w.r,
            from: winBy.from,
          });
          for (let i = 0; i < 4; i++) scores[i] += deltas[i];
          console.log(`  -> ${names[w.seat]} ${w.r.text} ${JSON.stringify(w.r.yaku)} +${pay}`);
        }
        scores[winBy.wins[0].seat] += ctx.riichiPool;
        ctx.riichiPool = 0;
      }
      console.log(`scores: ${scores.join('/')}`);
      // Base transition first; match-END policy (tobi / agari-yame / overtime)
      // is applied on top and must NOT re-increment honba or kyoku.
      applyFlow(MF.handOutcome({ kind: 'win', winnerSeats, dealer }));
      const bust = MF.bustOutSeat(scores);
      if (bust >= 0) {
        console.log(`TOBI BUST-OUT (${names[bust]}) - match over`);
        matchOver = true;
      } else if (allLast && dealerWon && MF.dealerLeads(scores, dealer)) {
        // agari-yame: leading dealer at all-last may end the match
        let end = true;
        if (P[dealer].id === HUMAN) {
          const a = (await ask('  you lead at all-last as dealer - end match or renchan? (end/renchan): '))
            .trim()
            .toLowerCase();
          end = !a.startsWith('rench');
        }
        if (end) {
          console.log('AGARI-YAME: leading dealer ends the match');
          matchOver = true;
        } else {
          overtime = true;
          console.log('ENCHOUSEN (overtime): dealer continues');
        }
      } else if (dealerWon) {
        console.log('dealer renchan');
        if (allLast) {
          overtime = true;
          console.log('ENCHOUSEN (overtime): dealer continues');
        }
      }
    } else {
      console.log('\n*** EXHAUSTIVE DRAW ***');
      // ryukyoku tenpai payments
      const tenpai = P.map((p) => getWaits(p, P, dead, { dora: [], bakaze, jikaze: 1 }).length > 0);
      if (process.env.DEBUG_END) {
        P.forEach((p, i) =>
          console.log(
            `  end ${names[i]} closed=${p.hand.join('')} melds=${p.melds.map(meldStr)} sh=${shantenOf(p.hand)} waits=${getWaits(p, P, dead, { dora: [], bakaze, jikaze: 1 })}`
          )
        );
      }
      const nTen = tenpai.filter(Boolean).length;
      console.log(`tenpai: ${P.map((p, i) => (tenpai[i] ? names[i] : 'x')).join(' ')}`);
      // nagashi mangan replaces the noten exchange
      const nagashi = [0, 1, 2, 3].filter((i) => isNagashi(P[i]));
      if (nagashi.length) {
        console.log(
          `NAGASHI MANGAN: ${nagashi.map((i) => names[i]).join(' ')} (all discards terminals/honors, closed)`
        );
        const order = [0, 1, 2, 3].map((k) => (dealer + k) % 4).filter((i) => nagashi.includes(i));
        // Shared payout (match-flow.js): a mangan tsumo per qualifying seat.
        const { deltas } = MF.nagashiPayments(order, dealer, honba);
        for (let i = 0; i < 4; i++) scores[i] += deltas[i];
        for (const w of order) console.log(`  -> ${names[w]} mangan tsumo`);
        scores[order[0]] += ctx.riichiPool;
        ctx.riichiPool = 0;
      } else if (nTen > 0 && nTen < 4) {
        // standard: 1 tenpai: +3000/-1000; 2: +1500/-1500; 3: +1000/-3000
        const { give, take } = MF.notenPayments(nTen);
        for (let i = 0; i < 4; i++) scores[i] += tenpai[i] ? give : -take;
        console.log(`noten payments (ten ${nTen}: +${give}/-${take})`);
      }
      const flow = MF.handOutcome({
        kind: 'exhaustive',
        tenpaiSeats: [0, 1, 2, 3].filter((i) => tenpai[i]),
        nagashiSeats: nagashi,
        dealer,
      });
      if (flow.honba === 'increment') honba++;
      riichiCarry = ctx.riichiPool;
      console.log(`scores: ${scores.join('/')} (honba ${honba}, carry ${riichiCarry})`);
      const bust2 = MF.bustOutSeat(scores);
      if (bust2 >= 0) {
        console.log(`TOBI BUST-OUT (${names[bust2]}) - match over`);
        matchOver = true;
      } else {
        if (flow.kyokuRepeat) kyoku--; // replay same kyoku number
        keepDealer = flow.keepDealer;
        console.log(keepDealer ? 'dealer renchan' : 'dealer rotates');
        if (keepDealer && allLast) {
          overtime = true;
          console.log('ENCHOUSEN (overtime): dealer continues at all-last');
        }
      }
    }
    if (matchOver) break;
    if (!keepDealer) dealer = (dealer + 1) % 4;
  }
  console.log('\n=== MATCH RESULT (oka 20 / uma +20/+10/-10/-20) ===');
  for (const r of applyOkaUma(scores)) {
    const f = (n) => (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));
    console.log(`  ${r.place}. P${r.seat} raw=${r.score} uma=${f(r.uma)} oka=${f(r.oka)} total=${f(r.total)}`);
  }
  console.log(`FINAL(raw): ${scores.join('/')}`);
  if (readline) readline.close();
}

// Only play a match when invoked directly. Without this guard, requiring this
// file from a test started a full hanchan on import.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
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

#!/usr/bin/env node
// Offline CLI test engine - hacks takayama-lily/riichi + syanten (see ../reference/)
// Usage:
//   node cli.js eval <hand>          e.g. node cli.js eval 112233456789m11s
//   node cli.js play [--power NAME]  interactive draw/discard vs wall
//   node cli.js demo                 scripted Saki-power demos (no input)
const readline = require('readline');
const Riichi = require('riichi');
const syanten = require('syanten');

const POWERS = ['none', 'saki', 'kuro', 'koromo', 'toki', 'yuuki', 'hisa', 'teru'];

// ---- tile helpers (34 kinds, 0m = aka) ----
const KINDS = [];
for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) KINDS.push(n + s);
for (let n = 1; n <= 7; n++) KINDS.push(n + 'z');
const kindIndex = Object.fromEntries(KINDS.map((k, i) => [k, i]));

function buildWall() {
  const wall = [];
  for (const k of KINDS) for (let i = 0; i < 4; i++) wall.push(k);
  // aka: turn one 5m/5p/5s into 0m/0p/0s (riichi lib convention)
  for (const [five, aka] of [['5m', '0m'], ['5p', '0p'], ['5s', '0s']]) {
    const idx = wall.indexOf(five);
    if (idx >= 0) wall[idx] = aka;
  }
  shuffle(wall);
  return wall;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function akaToFive(t) { return t[0] === '0' ? '5' + t[1] : t; }
function toCounts(hand) {
  // syanten lib wants [[m x9],[p x9],[s x9],[z x7]]
  const c = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0), Array(7).fill(0)];
  for (const t of hand) {
    const n = t[0] === '0' ? 5 : parseInt(t[0], 10);
    if (t[1] === 'm') c[0][n - 1]++;
    else if (t[1] === 'p') c[1][n - 1]++;
    else if (t[1] === 's') c[2][n - 1]++;
    else c[3][n - 1]++;
  }
  return c;
}
function shantenOf(hand) {
  try { return syanten(toCounts(hand)); } catch { return -99; }
}
function hairiOf(hand) {
  try { return syanten.hairi(toCounts(hand)); } catch (e) { return { error: String(e) }; }
}
function toHandStr(hand) {
  // serialize to riichi-lib format: 111m22p... (aka 0m kept)
  const groups = { m: [], p: [], s: [], z: [] };
  for (const t of hand) groups[t[1]].push(t[0]);
  let out = '';
  for (const s of ['m', 'p', 's', 'z']) if (groups[s].length) out += groups[s].sort().join('') + s;
  return out;
}
function calcYaku(hand) {
  try { return new Riichi(toHandStr(hand)).calc(); }
  catch (e) { return { error: String(e) }; }
}

// ---- Saki power hooks (draw rigging, server-side in real game) ----
function powerDraw(wall, hand, power, ctx) {
  const drawOne = () => wall.pop();
  if (power === 'none' || !wall.length) return drawOne();
  const baseShanten = shantenOf(hand);

  if (power === 'kuro') {
    // Dora magnet: prefer dora tiles (ctx.dora, e.g. ['5m']). 70% take dora if in next 8 tiles.
    const window = wall.slice(-8);
    const i = window.findIndex(t => ctx.dora.includes(akaToFive(t)));
    if (i >= 0 && Math.random() < 0.7) return wall.splice(wall.length - 8 + i, 1)[0];
    return drawOne();
  }
  if (power === 'saki') {
    // Rinshan luck: when tenpai/1-shanten, redraw once if draw doesn't improve
    const t = drawOne();
    const after = shantenOf([...hand, t].slice(-14));
    if ((baseShanten <= 1) && after >= baseShanten && wall.length && Math.random() < 0.6) {
      wall.unshift(t); // put back at front (dead-wall flavor)
      return drawOne();
    }
    return t;
  }
  if (power === 'koromo') {
    // Haitei: big boost in last 8 tiles of wall
    if (wall.length <= 8 && baseShanten <= 0 && Math.random() < 0.5) {
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      const i = wall.findIndex(t => waits.includes(akaToFive(t)));
      if (i >= 0) return wall.splice(i, 1)[0];
    }
    return drawOne();
  }
  if (power === 'yuuki') {
    // East-round monster: one free redraw if in east (ctx.roundWind === 'E')
    const t = drawOne();
    if (ctx.roundWind === 'E' && shantenOf([...hand, t].slice(-14)) >= baseShanten && wall.length && Math.random() < 0.5)
      return drawOne();
    return t;
  }
  if (power === 'hisa') {
    // Hell-wait: boost single-tile waits is scoring-side; here just luck when tenpai
    const t = drawOne();
    if (baseShanten === 0 && Math.random() < 0.25 && wall.length) {
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      if (waits.length <= 2) {
        const i = wall.findIndex(x => waits.includes(akaToFive(x)));
        if (i >= 0) { wall.push(t); return wall.splice(i, 1)[0]; }
      }
    }
    return t;
  }
  return drawOne(); // toki + teru handled at display/score layer
}

function fmtHand(hand) { return [...hand].sort().join(' '); }

async function cmdEval(handStr) {
  console.log(`hand: ${handStr}`);
  const r = new Riichi(handStr).calc();
  console.log(`agari=${r.isAgari} han=${r.han} fu=${r.fu} ten=${r.ten} yaku=${JSON.stringify(r.yaku)}`);
  if (r.hairi) console.log(`shanten now=${r.hairi.now}`);
  if (r.text) console.log(r.text);
  if (r.error) console.log('calc error flag');
}

async function cmdPlay(power = 'none') {
  if (!POWERS.includes(power)) { console.error(`unknown power. choose: ${POWERS.join(',')}`); process.exit(1); }
  const ctx = { dora: ['5m', '5p'], roundWind: 'E', power };
  const wall = buildWall();
  let hand = wall.splice(-13, 13);
  console.log(`power=${power} dora=${ctx.dora} wall=${wall.length} left`);
  console.log(`Toki precog: showing next 3 draws: ${power === 'toki' ? wall.slice(-3).reverse().join(' ') : '(disabled, use --power toki)'}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));
  let turns = 0;
  while (wall.length && turns < 40) {
    turns++;
    const st = shantenOf(hand);
    console.log(`\n[${turns}] hand(${hand.length}): ${fmtHand(hand)}  shanten=${st}`);
    if (power === 'toki') console.log(`  precog next3: ${wall.slice(-3).reverse().join(' ')}`);
    const t = powerDraw(wall, hand, power, ctx);
    hand.push(t);
    console.log(`  draw: ${t}  wall left=${wall.length}`);
    const y = calcYaku(hand.slice(-14));
    if (y.isAgari) {
      console.log(`  *** TSUMO! han=${y.han} fu=${y.fu} ten=${y.ten} ${JSON.stringify(y.yaku)} ***`);
      if (power === 'teru') console.log('  Teru streak: next hand value escalates (demo: +1 han flavor)');
      rl.close(); return;
    }
    const h = hand.length === 14 ? hairiOf(hand.slice(0, 13).length ? hand : hand) : null;
    if (h && h.now !== undefined) {
      const discards = Object.keys(h).filter(k => k !== 'now' && k !== 'wait');
      if (discards.length) console.log(`  suggested discards (hairi now=${h.now}): ${discards.slice(0, 6).join(' ')}`);
    }
    const ans = (await ask('  discard which tile? (e.g. 1m, q=quit): ')).trim();
    if (ans === 'q') break;
    const idx = hand.findIndex(x => x === ans || akaToFive(x) === ans);
    if (idx < 0) { console.log('  not in hand, auto-discarding draw.'); hand.pop(); wall.push(t); hand.push(wall.pop()); }
    else hand.splice(idx, 1);
  }
  console.log('\nwall exhausted or quit. final:', fmtHand(hand), 'shanten=', shantenOf(hand));
  rl.close();
}

async function cmdDemo() {
  console.log('== power demo: same seed hand, 200 simulated draws each ==');
  const testHand = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '1z'];
  console.log('base hand:', fmtHand(testHand), 'shanten=', shantenOf(testHand), 'hairi=', JSON.stringify(hairiOf(testHand)));
  console.log('yaku if completed example:', JSON.stringify(calcYaku([...testHand.slice(0, 12), '1z']).han));
  for (const p of ['none', 'saki', 'kuro', 'koromo', 'yuuki', 'hisa']) {
    let improved = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const wall = buildWall();
      const t = powerDraw(wall, testHand, p, { dora: ['5m'], roundWind: 'E' });
      if (shantenOf([...testHand, t].slice(-14)) < shantenOf(testHand)) improved++;
    }
    console.log(`  ${p.padEnd(6)} improvement rate: ${improved}/${N} (${(100 * improved / N).toFixed(1)}%)`);
  }
  console.log('toki: precog = server reveals wall.slice(-3) to owner only (see play --power toki)');
  console.log('teru: streak multiplier applied at scoring, not draw (see play tsumo message)');
}

(async () => {
  const [, , cmd, a1, a2] = process.argv;
  if (cmd === 'eval' && a1) return cmdEval(a1);
  if (cmd === 'play') {
    const m = process.argv.find(x => x.startsWith('--power'));
    const power = m ? m.split('=')[1] : (a1 || 'none');
    return cmdPlay(power);
  }
  if (cmd === 'demo') return cmdDemo();
  console.log('usage:\n  node cli.js eval <handStr>\n  node cli.js play [--power NAME]\n  node cli.js demo\npowers: ' + POWERS.join(','));
})();

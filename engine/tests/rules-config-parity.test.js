// rules-config-parity.test.js — keeps the two rule front-ends honest about their
// shared constants.
//
// Background: `rules-config.js` existed for a long time and was imported by
// *nothing*. `rules.test.js` asserted its values were correct, which passed
// happily while the file was dead documentation — both `engine/game.js` and
// `server/table.js` hardcoded their own copies of every number. That is the
// mechanism of KI-04: a rule fixed in one front-end is not fixed in the other,
// because they are not even reading the same value.
//
// Two things are therefore pinned here:
//   1. `rules-config.js` is LIVE — both front-ends import it.
//   2. Neither front-end reintroduces a hardcoded copy of a shared constant.
//
// The second is a source scan, which is blunt but has no false positives on the
// specific expressions listed. Those expressions are the ones that were duplicated;
// a generic "the number 1000 must not appear" rule would be useless, because 1000
// is legitimately everywhere (stick counts, display strings, comments).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { RULES } = require('../rules-config');

const ROOT = path.join(__dirname, '..', '..');
const GAME_JS = fs.readFileSync(path.join(ROOT, 'engine', 'game.js'), 'utf8');
const TABLE_JS = fs.readFileSync(path.join(ROOT, 'server', 'table.js'), 'utf8');
const HELPERS_JS = fs.readFileSync(path.join(ROOT, 'engine', 'helpers.js'), 'utf8');

// These snippets are regex metacharacter soup (`+`, `*`, `[`, `.`), so they must be
// escaped wholesale rather than searched for literally.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `selftest()` is a fixture body: it legitimately contains literal score arrays and
// payments, because asserting the numbers is the point of it. Scanning it for
// "hardcoded 25000" produces nothing but false positives, so it is cut out before
// the settlement paths are checked. Everything else in the file is live code.
const GAME_SETTLEMENT = GAME_JS.replace(
  /async function selftest[\s\S]*?\nasync function main/,
  '\nasync function main'
);

// ------------------------------------------------------------ the values

test('rules-config declares the values both front-ends settle with', () => {
  assert.equal(RULES.startScore, 25000);
  assert.equal(RULES.riichiValue, 1000);
  assert.equal(RULES.minWallForRiichi, 4);
  assert.equal(RULES.honbaTsumo, 100);
  assert.equal(RULES.honbaRon, 300);
  assert.equal(RULES.notenTotal, 3000);
  assert.equal(RULES.maxKan, 4);
  assert.equal(RULES.rinshanSlots, 4);
  assert.equal(RULES.deadWallLength, 14);
});

test('notenTotal splits into the standard per-seat schedule', () => {
  // 1 tenpai +3000/-1000, 2 +1500/-1500, 3 +1000/-3000, 0 and 4 nothing.
  const { notenTotal } = RULES;
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => [0, notenTotal, notenTotal / 2, notenTotal / 3][n]),
    [0, 3000, 1500, 1000]
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => [0, notenTotal / 3, notenTotal / 2, notenTotal][n]),
    [0, 1000, 1500, 3000]
  );
});

// ------------------------------------------------------- the config is live

test('both rule front-ends import rules-config', () => {
  for (const [name, src] of [
    ['engine/game.js', GAME_JS],
    ['server/table.js', TABLE_JS],
  ]) {
    assert.match(
      src,
      /require\('\.\.\/engine\/rules-config'\)|require\('\.\/rules-config'\)/,
      `${name} must read the shared constants instead of hardcoding them`
    );
  }
});

test('each shared constant is actually referenced, not merely imported', () => {
  // Catches the failure mode this file exists for: an import that is never used, or
  // a config entry nobody reads. `rules-config.js` was dead for its entire life and
  // only a human noticed.
  for (const key of ['startScore', 'riichiValue']) {
    assert.match(GAME_JS, new RegExp(`RULES\\.${key}\\b`), `engine/game.js should use RULES.${key}`);
    assert.match(TABLE_JS, new RegExp(`RULES\\.${key}\\b`), `server/table.js should use RULES.${key}`);
  }
  // The settlement numbers are consumed inside engine/match-flow.js (notenPayments,
  // minHan, winPayments, manganPayment, nagashiPayments), which itself reads RULES —
  // that indirection is the KI-04 sharing, not dead config. So each accepts either a
  // direct RULES.* use or a match-flow call.
  const viaFlow = /notenPayments|minHan|winPayments|manganPayment|nagashiPayments|match-flow/;
  for (const [name, src] of [
    ['engine/game.js', GAME_JS],
    ['server/table.js', TABLE_JS],
  ]) {
    for (const key of ['notenTotal', 'honbaTsumo', 'honbaRon']) {
      const direct = new RegExp(`RULES\\.${key}\\b`).test(src);
      assert.ok(direct || viaFlow.test(src), `${name} should consume ${key} directly or via match-flow`);
    }
  }
});

test('canRiichi reads the configured stake and wall minimum', () => {
  // helpers.js hardcoded 1000/4, which left RULES.riichiValue and
  // RULES.minWallForRiichi as dead config — the exact KI-04 pattern.
  assert.match(HELPERS_JS, /RULES\.riichiValue/, 'helpers.js should use RULES.riichiValue');
  assert.match(HELPERS_JS, /RULES\.minWallForRiichi/, 'helpers.js should use RULES.minWallForRiichi');
  assert.doesNotMatch(HELPERS_JS, /score >= 1000/, 'helpers.js hardcodes the riichi stake again');
});

test('both front-ends read the kan caps from RULES, not literals', () => {
  // `maxKan` and `rinshanSlots` were dead config; both loops used literal 4s.
  for (const [name, src] of [
    ['engine/game.js', GAME_JS],
    ['server/table.js', TABLE_JS],
  ]) {
    assert.match(src, /RULES\.maxKan/, `${name} should use RULES.maxKan`);
    assert.match(src, /RULES\.rinshanSlots/, `${name} should use RULES.rinshanSlots`);
  }
});

test('both front-ends route the hand transition through match-flow', () => {
  // game.js used to inline the whole post-hand transition and drifted from the
  // server on nagashi; handOutcome is now the single definition.
  assert.match(GAME_JS, /MF\.handOutcome\(/, 'engine/game.js should use MF.handOutcome');
  assert.match(TABLE_JS, /MF\.postHandFlow\(/, 'server/table.js should use MF.postHandFlow');
});

test('suufon-renda is checked after the call window in both drivers', () => {
  // The rule is "four identical wind opens, no calls". game.js used to check
  // before its pon/chi window, so a callable 4th first-lap discard could still
  // abort. table.js had the right ordering but no `callsMade` guard, so a call
  // on the 4th discard left the full accumulator armed for a later quiet
  // discard. Pin both halves.
  const suufonAt = GAME_JS.indexOf('SUUFON-RENDA');
  const calledAt = GAME_JS.indexOf('if (called) continue;');
  const chiAt = GAME_JS.indexOf('CHI ${disc}');
  assert.ok(suufonAt > 0 && calledAt > 0 && chiAt > 0, 'expected the sites in engine/game.js');
  assert.ok(suufonAt > calledAt, 'game.js must check suufon after the pon/kan window');
  assert.ok(suufonAt > chiAt, 'game.js must check suufon after the chi window');
  assert.match(TABLE_JS, /ctx\.callsMade === 0 && firstLap\.length === 4/);
});

// --------------------------------------- the duplication does not come back

test('engine/game.js settlement uses RULES, not literals', () => {
  const forbidden = [
    ['scores[pl.id] -= 1000', 'riichi stake'],
    ['+ 100 * honba', 'tsumo honba'],
    ['+ 300 * honba', 'ron honba'],
    ['[25000, 25000, 25000, 25000]', 'start score'],
    ['[0, 3000, 1500, 1000][nTen]', 'noten schedule'],
  ];
  for (const [snippet, what] of forbidden) {
    assert.doesNotMatch(GAME_SETTLEMENT, new RegExp(escapeRe(snippet)), `engine/game.js hardcodes the ${what} again`);
  }
});

test('server/table.js settlement uses RULES, not literals', () => {
  const forbidden = [
    ['this.scores[seat] -= 1000', 'riichi stake'],
    ['+ 100 * this.honba', 'tsumo honba'],
    ['+ 300 * this.honba', 'ron honba'],
    ['const START_SCORE = 25000', 'start score'],
    ['[0, 3000, 1500, 1000][nTen]', 'noten schedule'],
  ];
  for (const [snippet, what] of forbidden) {
    assert.doesNotMatch(TABLE_JS, new RegExp(escapeRe(snippet)), `server/table.js hardcodes the ${what} again`);
  }
});

test('both front-ends settle the mangan payment through match-flow, not inline', () => {
  for (const [name, src] of [
    ['engine/game.js', GAME_SETTLEMENT],
    ['server/table.js', TABLE_JS],
  ]) {
    assert.doesNotMatch(src, /\b(4000|2000)\b/, `${name} hardcodes a mangan payment again`);
    assert.match(src, /nagashiPayments/, `${name} should call MF.nagashiPayments`);
  }
  // The game.js-only chombo penalty shares the same pairwise rule.
  assert.match(GAME_SETTLEMENT, /manganPayment/, 'chombo should call MF.manganPayment');
});

test('both front-ends settle a win through match-flow, not inline', () => {
  for (const [name, src] of [
    ['engine/game.js', GAME_SETTLEMENT],
    ['server/table.js', TABLE_JS],
  ]) {
    assert.match(src, /winPayments/, `${name} should call MF.winPayments`);
    assert.doesNotMatch(src, /RULES\.honbaTsumo/, `${name} must not multiply the tsumo honba inline`);
    assert.doesNotMatch(src, /RULES\.honbaRon/, `${name} must not multiply the ron honba inline`);
  }
});

test('both front-ends gate their abortive draws through the shared switch', () => {
  // The abort flags were dead config for the whole life of this file (KI-04): two
  // identical objects read by nothing. This pins them live — each front-end reads
  // its own set through MF.abortEnabled and names all five aborts, so a handler
  // cannot be wired on one side and silently forgotten on the other.
  const names = ['kyuushuKyuuhai', 'suufonRenda', 'suukaikan', 'suuchaRiichi', 'tripleRon'];
  for (const [file, src, flags] of [
    ['engine/game.js', GAME_SETTLEMENT, 'RULES.aborts'],
    ['server/table.js', TABLE_JS, 'RULES.serverAborts'],
  ]) {
    assert.match(src, /abortEnabled/, `${file} should call MF.abortEnabled`);
    for (const n of names) {
      const re = new RegExp(`abortEnabled\\(\\s*${flags.replace('.', '\\.')}\\s*,\\s*'${n}'`);
      assert.match(src, re, `${file} must gate ${n} through ${flags}`);
    }
  }
});

test('both front-ends index the dead wall through match-flow, not a literal', () => {
  // The indicator stride was `4 + kanCount * 2` / `5 + kanCount * 2` copied into
  // both loops (KI-04 again). It is now `MF.doraIndicatorSlots`; this fails if a
  // literal copy returns.
  for (const [name, src] of [
    ['engine/game.js', GAME_SETTLEMENT],
    ['server/table.js', TABLE_JS],
  ]) {
    assert.match(src, /doraIndicatorSlots/, `${name} should call MF.doraIndicatorSlots`);
    assert.doesNotMatch(src, /kanCount \* 2/, `${name} must not re-derive the indicator stride`);
    assert.doesNotMatch(src, /dead\[[45]\]/, `${name} must not hard-code the initial indicator slot`);
  }
});

test('the two front-ends settle a riichi declaration identically', () => {
  // Same expression shape on both sides, so a change to one is a visible diff
  // against the other rather than an invisible divergence. Whitespace-tolerant:
  // prettier may put the debit and the pool credit on separate lines.
  const game = GAME_JS.match(/scores\[pl\.id\] ([+-]=) (RULES\.\w+);\s*ctx\.riichiPool \+= (RULES\.\w+);/);
  const table = TABLE_JS.match(/this\.scores\[seat\] ([+-]=) (RULES\.\w+);\s*ctx\.riichiPool \+= (RULES\.\w+);/);
  assert.ok(game, 'engine/game.js riichi debit not found in the expected shape');
  assert.ok(table, 'server/table.js riichi debit not found in the expected shape');
  assert.equal(game[2], 'RULES.riichiValue');
  assert.equal(table[2], 'RULES.riichiValue');
  assert.equal(game[3], 'RULES.riichiValue');
  assert.equal(table[3], 'RULES.riichiValue');
});

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

// These snippets are regex metacharacter soup (`+`, `*`, `[`, `.`), so they must be
// escaped wholesale rather than searched for literally.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `selftest()` is a fixture body: it legitimately contains literal score arrays and
// payments, because asserting the numbers is the point of it. Scanning it for
// "hardcoded 25000" produces nothing but false positives, so it is cut out before
// the settlement paths are checked. Everything else in the file is live code.
const GAME_SETTLEMENT = GAME_JS.replace(
  /async function selftest[\s\S]*?\nasync function main/,
  '\nasync function main',
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
    [0, 3000, 1500, 1000],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => [0, notenTotal / 3, notenTotal / 2, notenTotal][n]),
    [0, 1000, 1500, 3000],
  );
});

// ------------------------------------------------------- the config is live

test('both rule front-ends import rules-config', () => {
  for (const [name, src] of [['engine/game.js', GAME_JS], ['server/table.js', TABLE_JS]]) {
    assert.match(src, /require\('\.\.\/engine\/rules-config'\)|require\('\.\/rules-config'\)/,
      `${name} must read the shared constants instead of hardcoding them`);
  }
});

test('each shared constant is actually referenced, not merely imported', () => {
  // Catches the failure mode this file exists for: an import that is never used, or
  // a config entry nobody reads. `rules-config.js` was dead for its entire life and
  // only a human noticed.
  const gameUses = ['startScore', 'riichiValue', 'honbaTsumo', 'honbaRon', 'notenTotal'];
  const tableUses = ['startScore', 'riichiValue', 'honbaTsumo', 'honbaRon', 'notenTotal'];
  for (const key of gameUses) {
    assert.match(GAME_JS, new RegExp(`RULES\\.${key}\\b`),
      `engine/game.js should use RULES.${key}`);
  }
  for (const key of tableUses) {
    assert.match(TABLE_JS, new RegExp(`RULES\\.${key}\\b`),
      `server/table.js should use RULES.${key}`);
  }
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
    assert.doesNotMatch(GAME_SETTLEMENT, new RegExp(escapeRe(snippet)),
      `engine/game.js hardcodes the ${what} again`);
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
    assert.doesNotMatch(TABLE_JS, new RegExp(escapeRe(snippet)),
      `server/table.js hardcodes the ${what} again`);
  }
});

test('the two front-ends settle a riichi declaration identically', () => {
  // Same expression shape on both sides, so a change to one is a visible diff
  // against the other rather than an invisible divergence.
  const game = GAME_JS.match(/scores\[pl\.id\] ([+-]=) (RULES\.\w+); ctx\.riichiPool \+= (RULES\.\w+);/);
  const table = TABLE_JS.match(/this\.scores\[seat\] ([+-]=) (RULES\.\w+);\s*ctx\.riichiPool \+= (RULES\.\w+);/);
  assert.ok(game, 'engine/game.js riichi debit not found in the expected shape');
  assert.ok(table, 'server/table.js riichi debit not found in the expected shape');
  assert.equal(game[2], 'RULES.riichiValue');
  assert.equal(table[2], 'RULES.riichiValue');
  assert.equal(game[3], 'RULES.riichiValue');
  assert.equal(table[3], 'RULES.riichiValue');
});
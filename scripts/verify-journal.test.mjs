// verify-journal.test.mjs — CLI plumbing for the journal verifier.
//
// The verifier itself is covered end-to-end in server/test/journal.test.js
// against journals the Table actually wrote. These tests only pin the command:
// exit codes, one line per file, and the usage error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import replay from '../engine/replay.js';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-journal.mjs');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('verify-journal: a valid journal exits 0 and reports its counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saki-verify-'));
  try {
    const file = join(dir, 'empty.json');
    const j = replay.createJournal(42);
    replay.startKyoku(j, 42);
    writeFileSync(file, replay.toJSON(j));

    const r = run(file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OK .*: 0 draws, 0 discards, 0 calls$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-journal: an impossible action exits 1 and names the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saki-verify-'));
  try {
    const file = join(dir, 'bad.json');
    const j = replay.createJournal(42);
    replay.startKyoku(j, 42);
    replay.record(j, 0, 'swap', { slot: 99, tile: '1m' });
    writeFileSync(file, replay.toJSON(j));

    const r = run(file);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`FAIL ${file}`), r.stderr);
    assert.match(r.stderr, /bad wanpai slot 99/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-journal: no arguments prints usage and exits 2', () => {
  const r = run();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/verify-journal\.mjs/);
});

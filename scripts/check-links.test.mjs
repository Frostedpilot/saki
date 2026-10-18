// check-links.test.mjs — the link checker that gates CI had no test of its own.
//
// It is the tool that decides whether `npm run links` is green, so a bug here
// (a regex that stops matching, a skip that swallows a real link) would let
// dead links through silently. These tests drive `checkLinks(root)` against
// throwaway fixture trees, then run it against this repository for real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLinks } from './check-links.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'saki-links-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

test('a dead relative link is reported, a live one is not', (t) => {
  const dir = fixture({
    'README.md': '# Root\n\n[ok](./docs/a.md)\n[dead](./docs/missing.md)\n',
    'docs/a.md': '# A\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { dead, checked } = checkLinks(dir);
  assert.equal(checked, 2);
  assert.equal(dead.length, 1);
  assert.equal(dead[0].target, './docs/missing.md');
});

test('absolute URLs, anchors, mailto and reference defs are skipped', (t) => {
  const dir = fixture({
    'README.md':
      '# Root\n\n' +
      '[web](https://example.com/x)\n' +
      '[frag](#section)\n' +
      '[mail](mailto:a@b.c)\n' +
      '[ref]: https://example.com/ref\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { dead, checked } = checkLinks(dir);
  assert.equal(checked, 0, 'nothing here points at a local file');
  assert.deepEqual(dead, []);
});

test('parent-relative links resolve from the linking file, not the root', (t) => {
  const dir = fixture({
    'README.md': '# Root\n',
    'docs/a.md': '# A\n\n[up](../README.md)\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(checkLinks(dir).dead, []);
});

test('an anchor on a local file is stripped before resolving', (t) => {
  const dir = fixture({
    'README.md': '# Root\n\n[x](./docs/a.md#heading)\n',
    'docs/a.md': '# A\n\n## Heading\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(checkLinks(dir).dead, []);
});

test('duplicate top-level titles are reported', (t) => {
  const dir = fixture({
    'a.md': '# Same\n',
    'sub/b.md': '# Same\n',
    'sub/c.md': '# Different\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { dupes } = checkLinks(dir);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].title, 'Same');
  assert.equal(dupes[0].a, 'a.md');
  assert.equal(dupes[0].b, 'sub/b.md');
});

test('this repository has no dead links and no duplicate titles', () => {
  const { dead, dupes, checked } = checkLinks(REPO_ROOT);
  assert.deepEqual(dead, [], 'dead relative links in the repo docs');
  assert.deepEqual(dupes, [], 'duplicate top-level titles in the repo docs');
  // A canary: if the glob silently stopped matching, `checked` would collapse.
  assert.ok(checked > 50, `expected the real docs to be scanned (saw ${checked})`);
});

#!/usr/bin/env node
// check-links.mjs — verify every relative markdown link in the repo resolves.
//
// Catches the class of rot where a doc references a file that was renamed or
// removed. Absolute URLs, anchors, and paths under reference/ (gitignored, only
// present if you cloned the upstream engine yourself) are skipped.
//
// Usage: node scripts/check-links.mjs
// Exits non-zero and prints each dead link.

import { readFileSync, existsSync, globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'reference']);

// Match the target of an inline markdown link: [text](target)
const LINK_RE = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

const files = globSync('**/*.md', { cwd: ROOT, posix: false })
  .filter((p) => !p.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg)));

const dead = [];
let checked = 0;

for (const rel of files) {
  const abs = join(ROOT, rel);
  const text = readFileSync(abs, 'utf8');
  const dir = dirname(abs);
  for (const [, target] of text.matchAll(LINK_RE)) {
    if (/^(https?:|file:|mailto:|data:)/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    if (target.startsWith('reference/')) continue;
    // Strip an anchor/query before resolving.
    const clean = target.split('#')[0].split('?')[0];
    if (clean === '') continue;
    checked++;
    if (!existsSync(join(dir, clean))) {
      dead.push({ file: rel.split(/[\\/]/).join('/'), target });
    }
  }
}

if (dead.length) {
  console.error(`\n${dead.length} dead relative markdown link(s):\n`);
  for (const { file, target } of dead) console.error(`  ${file} -> ${target}`);
  console.error('');
  process.exit(1);
}

console.log(`OK: ${checked} relative markdown links across ${files.length} files resolve.`);
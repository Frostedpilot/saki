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

// Match the target of an inline markdown link: [text](target) with optional
// 'title' or "title", plus <target> autolinks. [ref] definitions are resolved
// separately below.
const LINK_RE = /\]\(\s*(<[^>\s]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const AUTOLINK_RE = /<((?:\.?\.?\/[^>\s]*|#[^>\s]*))>/g;
const REF_DEF_RE = /^\s*\[[^\]]+\]:\s*(\S+)/gm;

const files = globSync('**/*.md', { cwd: ROOT, posix: false })
  .filter((p) => !p.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg)));

const dead = [];
let checked = 0;

for (const rel of files) {
  const abs = join(ROOT, rel);
  const text = readFileSync(abs, 'utf8');
  const dir = dirname(abs);
  const targets = [
    ...[...text.matchAll(LINK_RE)].map((m) => m[1]),
    ...[...text.matchAll(AUTOLINK_RE)].map((m) => m[1]),
    ...[...text.matchAll(REF_DEF_RE)].map((m) => m[1]),
  ];
  for (let target of targets) {
    if (/^(https?:|file:|mailto:|data:)/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    // Skip HTML closing tags caught by the autolink pattern (e.g. </a> from
    // <a id="..."> anchors): a bare /tagname is not a link target.
    if (/^\/[A-Za-z][A-Za-z0-9]*$/.test(target)) continue;
    if (target.startsWith('reference/')) continue;
    // Strip an anchor/query before resolving; decode %20 etc.
    let clean = target.split('#')[0].split('?')[0];
    try { clean = decodeURIComponent(clean); } catch { /* keep raw */ }
    if (clean === '') continue;
    checked++;
    if (!existsSync(join(dir, clean))) {
      dead.push({ file: rel.split(/[\\/]/).join('/'), target });
    }
  }
}

// Duplicate top-level titles. Two docs claiming the same H1 is almost always one file
// having been overwritten with another's content, and it is invisible to a link check:
// the links all still resolve, they just resolve to the wrong document. This caught a
// real case — docs/development.md had been clobbered with the whole of
// docs/known-issues.md, title and all, and every link into development.md still "worked".
const titles = new Map();
const dupes = [];
for (const rel of files) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const m = text.match(/^#\s+(.+)$/m);
  if (!m) continue;
  const title = m[1].trim();
  const relPath = rel.split(/[\\/]/).join('/');
  if (titles.has(title)) {
    dupes.push({ title, a: titles.get(title), b: relPath });
  } else {
    titles.set(title, relPath);
  }
}

if (dead.length || dupes.length) {
  if (dead.length) {
    console.error(`\n${dead.length} dead relative markdown link(s):\n`);
    for (const { file, target } of dead) console.error(`  ${file} -> ${target}`);
    console.error('');
  }
  if (dupes.length) {
    console.error(`${dupes.length} duplicate markdown title(s):\n`);
    for (const { title, a, b } of dupes) {
      console.error(`  "${title}" is claimed by both ${a} and ${b}`);
    }
    console.error('\nOne document has probably been overwritten with another. '
      + 'Check `git log --follow` on the newer one.');
    console.error('');
  }
  process.exit(1);
}

console.log(`OK: ${checked} relative markdown links across ${files.length} files resolve.`);
console.log(`    ${titles.size} distinct document titles, no duplicates.`);
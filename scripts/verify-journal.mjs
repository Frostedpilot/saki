#!/usr/bin/env node
// verify-journal.mjs — replay a bridge match journal and prove it was legal.
//
// The server writes these when SAKI_JOURNAL_DIR is set (server/journal.js). Each
// recorded draw must still have been live, each discard must have come from the
// hand, each call must be reconstructible, and conservation must hold after
// every action. Verification is independent of the match that produced it: it
// rebuilds the wall from the per-kyoku seeds.
//
// Usage: node scripts/verify-journal.mjs <journal.json> [...]
// Prints one OK/FAIL line per file and exits non-zero if any file fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import replay from '../engine/replay.js';

export function verifyFile(file) {
  const journal = replay.fromJSON(readFileSync(file, 'utf8'));
  return replay.verifyJournal(journal);
}

function main(argv) {
  if (!argv.length) {
    console.error('usage: node scripts/verify-journal.mjs <journal.json> [...]');
    return 2;
  }
  let failed = 0;
  for (const file of argv) {
    try {
      const r = verifyFile(file);
      console.log(`OK ${file}: ${r.draws} draws, ${r.discards} discards, ${r.calls} calls`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${file}: ${e.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

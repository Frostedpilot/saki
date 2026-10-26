// journal.js — opt-in on-disk match journal for the bridge server.
//
// The engine's replay verifier (`engine/replay.js`) was tests-only because no
// production writer ever called `record`. Setting `SAKI_JOURNAL_DIR` turns the
// Table into that writer: every draw, discard and call is appended in the
// verifier's grammar, and the finished match is written as one JSON file.
//
// Off by default: an unset environment variable allocates nothing and performs
// no file I/O, so normal matches are unchanged.
const fs = require('node:fs');
const path = require('node:path');

const replay = require('../engine/replay');

function journalDir() {
  return process.env.SAKI_JOURNAL_DIR || null;
}

function fileFor(dir, seed) {
  return path.join(dir, `match-${seed >>> 0}.json`);
}

// Pretty-print only the top level: actions stay one per line so a journal is
// diffable without a JSON formatter.
function serialize(journal) {
  const lines = journal.actions.map((a) => '    ' + JSON.stringify(a));
  return (
    '{\n' +
    `  "initialSeed": ${JSON.stringify(journal.initialSeed)},\n` +
    `  "kyokuSeeds": ${JSON.stringify(journal.kyokuSeeds)},\n` +
    '  "actions": [\n' +
    lines.join(',\n') +
    (lines.length ? '\n' : '') +
    '  ]\n' +
    '}\n'
  );
}

function writeJournal(dir, journal) {
  fs.mkdirSync(dir, { recursive: true });
  const file = fileFor(dir, journal.initialSeed);
  fs.writeFileSync(file, serialize(journal), 'utf8');
  return file;
}

module.exports = { journalDir, fileFor, serialize, writeJournal, verifyJournal: replay.verifyJournal };

// journal.test.js — the bridge's opt-in on-disk journal (SAKI_JOURNAL_DIR).
//
// Before this, `engine/replay.js` was tests-only: no production writer ever
// called `record`. These tests drive a real hand through the Table with the
// writer enabled and feed the file back to the verifier, which is the only way
// to know the recorded grammar matches what the table actually does.
process.env.BOT_DELAY_MS = '0';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Table } = require('../table');
const replay = require('../../engine/replay');

function makeTable(seed, powerSeats = ['none', 'none', 'none', 'none']) {
  const room = {
    code: 'JOURNAL',
    powerSeats,
    seats: [null, null, null, null], // all CPU
    sendTo() {},
    broadcastRoomState() {},
    afterGameOver() {},
  };
  const t = new Table(room, seed);
  t.broadcast = () => {};
  t.broadcastMessage = () => {};
  t.broadcastPowerStatus = () => {};
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];
  t.clearMailbox = () => {};
  t.waitForReady = async () => {};
  t.totalRounds = 4;
  t.kyoku = 1;
  return t;
}

test('a played hand writes a journal the verifier accepts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saki-journal-'));
  const previous = process.env.SAKI_JOURNAL_DIR;
  process.env.SAKI_JOURNAL_DIR = dir;
  try {
    const t = makeTable(24680);
    await t.playOneHand();
    const file = t.flushJournal();

    assert.ok(file, 'journaling must produce a file when the directory is set');
    assert.ok(fs.existsSync(file));
    assert.equal(path.dirname(file), dir);

    const journal = replay.fromJSON(fs.readFileSync(file, 'utf8'));
    assert.equal(journal.initialSeed, 24680);
    assert.ok(journal.actions.length > 0);

    // Throws on the first draw/discard/call the table could not have made.
    const r = replay.verifyJournal(journal);
    assert.ok(r.draws > 0, 'the hand must have drawn tiles');
    assert.ok(r.discards > 0, 'the hand must have discarded tiles');
  } finally {
    if (previous === undefined) delete process.env.SAKI_JOURNAL_DIR;
    else process.env.SAKI_JOURNAL_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a power match journal verifies across hands', async () => {
  // Powers are where the grammar earns its keep: a kan can swap a live tile
  // into a wanpai slot (seedKanDora, sampleRinshan), and the verifier has to
  // apply that swap before the replacement draw. Seed 2 with seats 1-3 powered
  // reaches both a kan and a swap in a short match.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saki-journal-powers-'));
  const previous = process.env.SAKI_JOURNAL_DIR;
  process.env.SAKI_JOURNAL_DIR = dir;
  try {
    const t = makeTable(2, ['none', 'saki', 'koromo', 'yuuki']);
    let hands = 0;
    while (!t.matchOver && hands < 12) {
      await t.playOneHand();
      hands++;
    }
    const file = t.flushJournal();
    assert.ok(file && fs.existsSync(file));
    const journal = replay.fromJSON(fs.readFileSync(file, 'utf8'));
    assert.ok(journal.actions.some((a) => a[0] === 'call' && a[2] && a[2].kind === 'kakan'));
    assert.ok(
      journal.actions.some((a) => a[0] === 'swap'),
      'this seed must exercise a wanpai swap'
    );
    replay.verifyJournal(journal); // throws on the first impossible action
  } finally {
    if (previous === undefined) delete process.env.SAKI_JOURNAL_DIR;
    else process.env.SAKI_JOURNAL_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('journaling is off when SAKI_JOURNAL_DIR is unset', async () => {
  const previous = process.env.SAKI_JOURNAL_DIR;
  delete process.env.SAKI_JOURNAL_DIR;
  try {
    const t = makeTable(24681);
    assert.equal(t.journalDir, null);
    await t.playOneHand();
    assert.equal(t.journal, null);
    assert.equal(t.flushJournal(), null);
  } finally {
    if (previous !== undefined) process.env.SAKI_JOURNAL_DIR = previous;
  }
});

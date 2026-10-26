# Changelog

All notable changes to this project are recorded here for development history. The
project is private and has no release process.

## 1.0.0 — 2026-10-25

First full snapshot. The engine, bridge server and web client are feature-complete
for the implemented rules (four-player riichi, East and South rounds, the six-primitive
power framework); the 2026-10 audit is closed.

### Added

- Web client test suite (Vitest + jsdom) covering the tile model, rendering, the
  reactive store and the socket, plus a strict `tsc` gate and production build.
- CI for engine, server, scripts and client, with ESLint, Prettier, markdown link
  checking and a CLI smoke test.
- Deterministic action journal and verifier (`engine/replay.js`), an opt-in
  on-disk writer for the bridge (`SAKI_JOURNAL_DIR`) and a
  `scripts/verify-journal.mjs` replayer that proves every draw, discard, call and
  wanpai swap was legal.
- Seeded RNG (`--seed`) with reproducible matches and a golden CLI fingerprint test.
- A table-driven scoring corpus (24 fixtures) pinning every standard yaku, yakuman
  stacking and the 20/30/40/50/60-fu boundaries, plus a double-ron settlement case
  covering honba and carried riichi sticks.
- Provenance records for the vendored assets — including the pinned upstream commit and
  protocol version for the prebuilt client — and forward-only Git LFS tracking for the
  two large binaries.
- The missing server rules: all five abortive draws, nagashi mangan, agari-yame and the
  chombo-as-penalty flow.

### Changed

- The offline CLI and the network server now share one turn driver
  (`engine/hand-driver.js` `playHand` / `playTurn`), built on the shared single-turn
  decisions in `engine/turn-core.js`, the rule helpers in `engine/helpers.js` and the
  hand-transition and score arithmetic in `engine/match-flow.js`.
- Rule constants and switches are data (`engine/rules-config.js`) instead of duplicated
  literals; a parity test fails if either front-end reintroduces a copy.
- `--seed` now creates one match-scoped RNG threaded through the wall shuffle, the
  offline power rig and the bot brains instead of replacing global `Math.random`.
- The oversized modules were split: the CLI selftest, server powers, call window and
  client event reducer moved to their own files.
- Bot pacing, turn timers and lifecycle hooks (`onPreDeal`, `onWallSetup`,
  `onTurnStart`, `onTurnEnd`, `getTurnClock`) now run end-to-end.

### Fixed

- Permanent-furiten and temporary-furiten handling, including riichi passers and
  rinshan draws.
- Call-window priority now follows turn order rather than response arrival.
- Double/triple ron settlement, honba and riichi-stick conservation at exhaustive
  draws and at match end.
- Kakan in riichi is refused; a wait-changing ankan is a chombo that replays the hand.
- Kyuushu-kyuuhai counts distinct terminal/honor kinds, and CPU bots no longer declare
  it illegally.
- Ankan no longer deletes another player's river tile or crashes the call log; kan dora
  seeds into the correct slot; aka waits are counted once.
- A malformed frame or a throwing character hook can no longer kill the process or
  brick the room.
- The static HTTP handler distinguishes a missing path (`404`) from an unreadable file
  (logged `500`), and rejects malformed URLs and paths escaping `server/public/`.
- The client reconnects without losing its seat, and no longer mis-translates
  `NotInTurn` / `CallWindowClosed` errors.
- An ankan or kakan now sends the authoritative post-kan hand to the client, so
  the kan tiles stop lingering in hand and later discards/riichi stay in sync.

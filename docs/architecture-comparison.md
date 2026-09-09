# Architecture Comparison: Accuracy and Reliability First

Scope: normal riichi core only. Powers excluded.
Compares ours (`docs/engine-implementation.md`) vs reference
(`docs/reference-riichi-advanced.md`).

## 1. TL;DR comparison

| | Ours (`engine/`, `server/`) | Reference (`reference/riichi_advanced`) |
|---|---|---|
| Paradigm | Imperative JS: rules are code | Data-driven: `.majs`/`.json` interpreted by Elixir + Rust + Z3 |
| Wall | Shuffled array `wall.pop()` (`engine/game.js:54-60`) or counted `DynamicPool.sample()` (`engine/core.js`, `engine/powers/dynamicPool.js:57-80`) | Declared `wall[]` + `reserved_tiles` + `revealed_tiles`, mutated by verbs (`swap_tiles`, `extend_*_wall_with_marked`, `reveal_tile`) |
| Scoring | Delegated to `riichi` + `syanten` npm libs (`engine/scoring.js:9-25`) | Own engine: `yaku_lists`, fu constants, Rust matcher, Z3 joker solver |
| Turn flow | `while` loop: draw → kan → tsumo → discard → ron → calls (`engine/game.js:552-884`, `server/room.js:666-799`) | Event hooks: `after_start`, `before/after_turn_change`, `before/after_call`, `after_draw`, `before_win` (`saki.json:926-1701`) |
| Powers | Per-character JS classes: Flow 0–150, draw weights, slot reservation | Per-card JSON buttons: `status` + `show_when` + `actions`; aliases + counters; draft at start (`saki.ex:74-143`, `saki.json:1713+`) |

Same skeleton (136 + aka, 13 tiles, kamicha-only chii, pon > chii, ron > all,
open hand bans riichi, calls kill ippatsu, dora is not yaku, ura for riichi
winners, honba +100/payer on tsumo and +300 on ron in both `engine/game.js:956-971`
and reference `saki.json:884-908` via `scoring_old.ex:308,332`). Different defaults:
ours enables abortive draws by default (`engine/game.js:461-757`); reference base has
none (`riichi.majs:136-139`, each an opt-in `define_mod`).

## 2. Which architecture is better?

Neither wins outright.

- Ours: cheap to run, read, test (`node game.js --selftest`, `npm test`),
  single-language stack with `web-client/` + `server/`. Best for one fixed
  ruleset and fast iteration. Weakness: powers scale as code; nth character
  risks rule breakage; rule variants become core-loop branches.
- Reference: best for 28+ rulesets and user content. Whitelisted verbs make
  pond/hand/dora swaps and mulligans safe by construction; tunables are mods,
  not forks. Weakness: Elixir/Phoenix + Rust + Z3 ops, new DSL, 4400-line
  `saki.json`, harder to trace than a stack trace.

For this repo (solo/small team, JS full stack, one game), ours is the better
fit. Do not import their stack. Steal four ideas: powers return intents while
`core.js`/`room.js` executes (already started with `reserveSlot`,
`exchangeDeadWallSlot`/`sampleRinshan`, `flow.consume`); card identity as
`status` + `-disabled` (`saki.ex:141-184`); aborts/scoring as config, not
branches; draft up front (`draft_saki_card`, `after_saki_start`).

## 3. Accuracy and reliability: the real risks in ours

1. **Duplicated truth.** `engine/game.js:48-86` re-implements `tiles.js`;
   `server/helpers.js:1-6` re-extracts it; `server/room.js:Table` mirrors the
   turn loop as events. Drift is inevitable.
2. **Black-box scoring.** String-built input to `riichi` + `syanten` with `^`
   ranges. Correct until the lib changes. Selftest (`engine/game.js:308-419`)
   is ~30 cases, not a yaku/fu corpus.
3. **Furiten bug class.** `me.tempFuriten=false` on every own draw
   (`engine/game.js:555`, `server/room.js:674`). Reference keeps furiten under
   riichi (`furiten.majs:10-24`). Under official riichi rules, passing any winning
   tile while in riichi places the player in permanent furiten for the remainder
   of the round. In our codebase, the flag is cleared on the very next draw:
   a riichi passer can ron again if someone discards their wait later!
   Fix: gate furiten clearing with `if (!me.riichi && !me.doubleRiichi) me.tempFuriten = false;`.
4. **Documented gaps.** No open-riichi, no pao (`engine/game.js:14`); server
   drops most aborts (`server/room.js:9-12`); `--seed` patches `Math.random`
   with a weak LCG instead of injected `RNG`.
5. **No replay log.** Seed + action list is not persisted; disputes are not
   reproducible. Reference has log/supervision (`log/`, `application.ex`).

Reference is more accurate as a spec: one interpreter, explicit `define_mod`
deviations, status-machine furiten/riichi/ippatsu, live multi-ruleset traffic.
It is less reliable as a runtime for us (new stack, own matcher bugs to own).

## 4. Fix plan (normal riichi first, in order)

### Phase 1: Rule Correctness & Critical Bug Fixes
- **Fix Riichi Furiten Leak**:
  - In `engine/game.js:555` and `server/room.js:674`, guard `me.tempFuriten = false` so that it never resets if `me.riichi || me.doubleRiichi`.
  - Add regression unit tests asserting that passing a winning discard under riichi prevents all subsequent ron attempts for that kyoku, while still allowing valid tsumo.
- **RNG Determinism Unification**:
  - Replace the global `Math.random` monkey-patching in `engine/game.js:42-45` with the `createRNG(seed)` utility from `engine/rng.js`.
  - Ensure seeded runs yield 100% reproducible tile sequences across both offline and online layers.

### Phase 2: Deduplication & Single Source of Truth
- **Eliminate Tile/Wall Duplicate Code**:
  - Remove redundant implementations of `KINDS`, `norm`, `same`, `toCounts`, `toHandStr`, and `DORA_NEXT` in `engine/game.js:48-86`.
  - Import them directly from `engine/tiles.js`.
- **Harmonize Rule Helpers**:
  - Ensure `server/helpers.js` and `engine/game.js` share the exact same wait-generation, kuikae-checking, and call-arbitration logic without divergent copy-pastes.

### Phase 3: Exact Pinning & Comprehensive Scoring Test Corpus
- **Pin Dependencies**:
  - Change `"riichi": "^1.2.0"` and `"syanten": "^1.6.0"` in `engine/package.json` to exact versions (`"1.2.0"`, `"1.6.0"`) to prevent silent scoring drift.
- **Expand Test Vectors (200+ Cases)**:
  - Expand `engine/game.js:selftest` from ~30 ad-hoc checks into a structured fixture-based test suite (`engine/tests/rules/`).
  - Cover every standard yaku (including chankan, rinshan, haitei, houtei, double riichi, chiitoitsu, kokushi, chuuren, and double yakuman).
  - Add fu boundary cases (pinfu-tsumo 20 fu, chiitoitsu flat 25 fu, open 30 fu minimum, terminal/honor kan fu multipliers).
  - Add multi-ron test cases (honba and riichi stick allocation to nearest player in turn order).

### Phase 4: Match Loop & Architecture Unification
- **Align Server & Offline Turn Loop**:
  - Unify `server/room.js:Table.playTurn` and `engine/game.js` turn dispatching so that both share identical state transition sequences: draw → kan check → tsumo check → discard → call window arbitration.
  - Implement missing abortive draw handlers (or explicitly gate them behind a shared rules configuration object instead of hardcoded code omissions).
- **Per-Turn Invariant Assertions**:
  - Integrate `pool.audit()` (`engine/powers/dynamicPool.js:83-98`) into dev/test runs to assert 136-tile conservation after every draw, meld, and discard.
  - Assert dead wall length is strictly 14 and scores remain zero-sum at every settlement.

### Phase 5: Deterministic Replay & Audit Journaling
- **Action Journaling**:
  - Store `{ initialSeed, kyokuSeeds, actions: [[seat, actionType, payload], ...] }` for every match.
  - Implement a replay runner (`engine/replay.js`) that re-executes action logs from seed to verify game state matching at every step.

## 5. Implementation status (done)

- Phase 1: gate in `engine/game.js` (own-draw clear) + `server/helpers.js`
  `clearTempFuritenOnDraw` used by `server/room.js:playTurn`; regression in
  `engine/tests/furiten-riichi.test.js` (5 tests).
- Phase 1 RNG: `--seed` now backs `Math.random` with `createRNG` (mulberry32);
  `seed=7/kyoku=1` reproduces byte-identical results.
- Phase 2: `game.js` tile/scoring helpers deleted, imported from
  `engine/tiles.js` + `engine/scoring.js`; abort helpers annotated with
  canonical copies in `server/helpers.js` (`isSuufonRenda`,
  `isSuukaikanAbort`, `isNagashi` added + exported).
- Phase 3: exact pins (`riichi 1.2.0`, `syanten 1.6.0`, engine + server);
  corpus in `engine/tests/rules.test.js` (27 tests: yaku, fu, dora/aka,
  flags, shibari, waits, aborts, kuikae, ankan, nagashi, oka/uma).
- Phase 4: `engine/rules-config.js` (RULES defaults; server aborts gated off),
  `engine/invariants.js` (conservation, dead wall, hand size, scores).
- Phase 5: `engine/replay.js` (journal + `verifyJournal` via `core.js`);
  covered in `rules.test.js` incl. tamper rejection.
- Full suite: `node --test tests/` 254 pass / 0 fail + `game.js --selftest`
  43 checks; server `npm test` 2 pass / 0 fail.

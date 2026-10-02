# Architecture Comparison: Accuracy and Reliability First

Scope: normal riichi core only. Powers excluded.
Compares ours (`docs/engine-implementation.md`) vs reference
(`docs/reference-riichi-advanced.md`).

> **Citation style.** Ours-side references are by file + symbol. Reference-side
> references (`reference/riichi_advanced/**`) are reproduced from the upstream clone,
> which is gitignored and **not present in a fresh checkout** — treat those as
> unverified unless you have cloned it yourself.

## 1. TL;DR comparison

| | Ours (`engine/`, `server/`) | Reference (`reference/riichi_advanced`) |
|---|---|---|
| Paradigm | Imperative JS: rules are code | Data-driven: `.majs`/`.json` interpreted by Elixir + Rust + Z3 |
| Wall | Shuffled array `wall.pop()` (`engine/game.js` `buildWall`) or counted `DynamicPool.sample()` (`engine/powers/dynamicPool.js`) | Declared `wall[]` + `reserved_tiles` + `revealed_tiles`, mutated by verbs (`swap_tiles`, `extend_*_wall_with_marked`, `reveal_tile`) |
| Scoring | Delegated to `riichi` + `syanten` npm libs (`engine/scoring.js` `scoreHand`) | Own engine: `yaku_lists`, fu constants, Rust matcher, Z3 joker solver |
| Turn flow | `while` loop: draw → kan → tsumo → discard → ron → calls (`engine/game.js` `main`; `server/room.js` `Table.playTurn`) | Event hooks: `after_start`, `before/after_turn_change`, `before/after_call`, `after_draw`, `before_win` (`saki.json`) |
| Powers | Per-character JS hook objects: Flow 0–150, draw weights, slot reservation (`engine/powers/rosters/*`) | Per-card JSON buttons: `status` + `show_when` + `actions`; aliases + counters; draft at start (`saki.ex`, `saki.json`) |

Same skeleton (136 + aka, 13 tiles, kamicha-only chii, pon > chii, ron > all,
open hand bans riichi, calls kill ippatsu, dora is not yaku, ura for riichi
winners, honba +100/payer on tsumo and +300 on ron — ours in `engine/rules-config.js`
`RULES.honbaTsumo`/`honbaRon`, reference in `saki.json` via `scoring_old.ex`).
Different defaults: ours enables all five abortive draws by default
(`RULES.aborts`); the reference base has none, each an opt-in `define_mod`.

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
`status` + `-disabled` (`saki.ex`); aborts/scoring as config, not
branches; draft up front (`draft_saki_card`, `after_saki_start`).

## 3. Accuracy and reliability: the real risks in ours

Status tags: **[FIXED]** landed — see §5. **[OPEN]** still true.

1. **Duplicated truth.** *Partly fixed.* `engine/game.js` now imports from
   `engine/tiles.js` instead of re-implementing it (Phase 2). Still duplicated:
   `engine/cli.js` re-declares `KINDS` and its own `buildWall`; `server/helpers.js`
   re-extracts helper logic from `game.js`; `server/room.js` `Table` mirrors the turn
   loop as events. Drift remains possible between `cli.js` and `tiles.js`, and between
   the offline and server rule paths (different abort configuration).
2. **Black-box scoring.** *Partly fixed.* String-built input to `riichi` + `syanten`
   with `^` ranges. Correct until the lib changes — mitigated by exact version pins and
   `engine/tests/rules.test.js` (27 tests). Still thin: no exhaustive yaku/fu corpus,
   and `game.js` `selftest()` is 43 ad-hoc checks rather than a fixture suite.
3. **Furiten bug class.** **[FIXED]** This was a live bug: `me.tempFuriten=false` ran
   on every own draw, so a riichi passer could ron again later in the round. Guarded
   with `if (!me.riichi && !me.doubleRiichi)`, via `server/helpers.js`
   `clearTempFuritenOnDraw` on the server side. Pinned by
   `engine/tests/furiten-riichi.test.js` (5 tests). Reference behaviour is in
   `furiten.majs`.
4. **Documented gaps.** **[OPEN]** No open-riichi, no pao (see the `game.js` header);
   the server drops all five aborts (`RULES.serverAborts`); `--seed` still backs
   `Math.random` via `createRNG` rather than threading an `RNG` through the offline
   turn loop, so offline and online determinism are separate mechanisms.
5. **No replay log.** *Partly fixed.* `engine/replay.js` implements the journal and
   verifier, but matches are not persisted — nothing writes a journal to disk, so real
   disputes are still not reproducible. Reference has log/supervision
   (`log/`, `application.ex`).

Reference is more accurate as a spec: one interpreter, explicit `define_mod`
deviations, status-machine furiten/riichi/ippatsu, live multi-ruleset traffic.
It is less reliable as a runtime for us (new stack, own matcher bugs to own).

## 4. Fix plan (normal riichi first, in order)

### Phase 1: Rule Correctness & Critical Bug Fixes
- **Fix Riichi Furiten Leak**: ✅ done
  - Guarded `me.tempFuriten = false` in `engine/game.js` so it never resets if `me.riichi || me.doubleRiichi`; added `server/helpers.js` `clearTempFuritenOnDraw`, called from `Table.playTurn`.
  - Regression tests in `engine/tests/furiten-riichi.test.js` assert that passing a winning discard under riichi prevents all subsequent ron attempts for that kyoku, while still allowing valid tsumo.
- **RNG Determinism Unification**: ⚠️ partly done
  - The global `Math.random` monkey-patching in `engine/game.js` now backs onto `createRNG(seed)` (mulberry32) from `engine/rng.js`.
  - Still open: the offline turn loop does not thread an `RNG` through state the way `core.createMatchState` does, so the two layers still derive reproducibility differently.

### Phase 2: Deduplication & Single Source of Truth
- **Eliminate Tile/Wall Duplicate Code**: ✅ done for `game.js`, ⚠️ open for `cli.js`
  - Removed the redundant `KINDS`, `norm`, `same`, `toCounts`, `toHandStr`, and `DORA_NEXT` from `engine/game.js`; it now imports from `engine/tiles.js`.
  - Still open: `engine/cli.js` re-declares `KINDS` and its own `buildWall`.
- **Harmonize Rule Helpers**: ⚠️ partly done
  - Canonical copies of the abort/nagashi helpers live in `server/helpers.js`.
  - Still open: wait generation, kuikae checking, and call arbitration are still separate implementations in `engine/game.js` and `server/room.js`.

### Phase 3: Exact Pinning & Comprehensive Scoring Test Corpus
- **Pin Dependencies**: ✅ done — exact versions (`riichi` `1.2.0`, `syanten` `1.6.0`) in both `engine/package.json` and `server/package.json`.
- **Expand Test Vectors**: ⚠️ partly done
  - Landed as `engine/tests/rules.test.js` (27 tests: yaku, fu, dora/aka, flags, shibari, waits, aborts, kuikae, ankan, nagashi, oka/uma). **Note:** this shipped as a *file*, not the `engine/tests/rules/` fixture directory originally planned.
  - Coverage gaps remain: no structured fixtures, and no double-ron honba/riichi-stick allocation cases.

### Phase 4: Match Loop & Architecture Unification
- **Align Server & Offline Turn Loop**: ⚠️ partly done
  - Abortive draws are now gated behind shared config (`engine/rules-config.js`, `RULES.aborts` vs `RULES.serverAborts`) instead of hardcoded omissions.
  - Still open: `Table.playTurn` and the `engine/game.js` turn dispatch are separate state machines.
- **Per-Turn Invariant Assertions**: ✅ done — `engine/invariants.js` (conservation via `DynamicPool.audit`, dead wall length, hand size, zero-sum scores).

### Phase 5: Deterministic Replay & Audit Journaling
- **Action Journaling**: ⚠️ partly done — `engine/replay.js` provides `record`/`verifyJournal` and replays through `core.js`, covered in `rules.test.js` including tamper rejection. **Nothing writes journals to disk**, so this is a capability, not a feature in use.
- **Replay runner**: ✅ done — `engine/replay.js`.

## 5. Implementation status

- Phase 1: gate in `engine/game.js` (own-draw clear) + `server/helpers.js`
  `clearTempFuritenOnDraw` used by `Table.playTurn`; regression in
  `engine/tests/furiten-riichi.test.js` (5 tests).
- Phase 1 RNG: `--seed` now backs `Math.random` with `createRNG` (mulberry32);
  `seed=7/kyoku=1` reproduces byte-identical results. *(Offline loop still does not
  thread an `RNG` through state like `core.js` does — see §3.4.)*
- Phase 2: `game.js` tile/scoring helpers deleted, imported from
  `engine/tiles.js` + `engine/scoring.js`; abort helpers annotated with
  canonical copies in `server/helpers.js` (`isSuufonRenda`,
  `isSuukaikanAbort`, `isNagashi` added + exported). *(`cli.js` still duplicates
  `KINDS` and `buildWall`.)*
- Phase 3: exact pins (`riichi 1.2.0`, `syanten 1.6.0`, engine + server);
  corpus in `engine/tests/rules.test.js` (27 tests: yaku, fu, dora/aka,
  flags, shibari, waits, aborts, kuikae, ankan, nagashi, oka/uma).
- Phase 4: `engine/rules-config.js` (RULES defaults; server aborts gated off),
  `engine/invariants.js` (conservation, dead wall, hand size, scores).
  *(Server and offline turn loops are still separate state machines.)*
- Phase 5: `engine/replay.js` (journal + `verifyJournal` via `core.js`);
  covered in `rules.test.js` incl. tamper rejection. *(No persistence to disk.)*
- Full suite: `node --test tests/*.test.js` **310 pass / 0 fail** + `game.js --selftest`
  **43 checks**; server `npm test` **3 pass / 0 fail**. (Use the glob form — a bare
  directory argument is rejected by Node 22; see `docs/development.md` §5.)

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
| Turn flow | `while` loop: draw → kan → tsumo → discard → ron → calls (`engine/game.js` `main`; `server/table.js` `Table.playTurn`) | Event hooks: `after_start`, `before/after_turn_change`, `before/after_call`, `after_draw`, `before_win` (`saki.json`) |
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
`core.js`/`table.js` executes (already started with `reserveSlot`,
`exchangeDeadWallSlot`/`sampleRinshan`, `flow.consume`); card identity as
`status` + `-disabled` (`saki.ex`); aborts/scoring as config, not
branches; draft up front (`draft_saki_card`, `after_saki_start`).

## 3. Accuracy and reliability: the real risks in ours

Status tags: **[FIXED]** landed — see §5. **[OPEN]** still true.

1. **Duplicated truth.** **[FIXED]** `engine/game.js` imports `engine/tiles.js`;
   `engine/cli.js` is now only an `eval` wrapper over the `riichi` package (no local
   tile helpers); the waits/furiten/abort/nagashi/kuikae helpers exist once in
   `engine/helpers.js`; and both front-ends are adapters over the shared
   `engine/hand-driver.js` (`playHand`/`playTurn`), so the turn order cannot drift.
   What stays separate is deliberate — I/O, the draw model, powers and the settlement
   shape — and is recorded in [`turn-loop-merge.md`](turn-loop-merge.md).
2. **Black-box scoring.** *Mitigated.* String-built input to `riichi` + `syanten`
   with `^` ranges. Correct until the lib changes — mitigated by exact version pins,
   `engine/tests/rules.test.js` (36 tests) and `engine/tests/scoring-corpus.test.js`
   (24 table-driven yaku/yakuman/fu fixtures, including the 20/30/40/50/60-fu
   boundaries). `engine/selftest.js` remains 48 ad-hoc checks rather than a fixture
   suite.
3. **Furiten bug class.** **[FIXED]** This was a live bug: `me.tempFuriten=false` ran
   on every own draw, so a riichi passer could ron again later in the round. Guarded
   with `if (!me.riichi && !me.doubleRiichi)`, via `engine/helpers.js`
   `clearTempFuritenOnDraw` on the server side. Pinned by
   `engine/tests/furiten-riichi.test.js` (5 tests). Reference behaviour is in
   `furiten.majs`.
4. **Documented gaps.** **[OPEN]** No open-riichi, no pao (see the `game.js` header).
   Both front-ends now implement and gate all five abortive draws
   (`RULES.aborts` / `RULES.serverAborts` via `MF.abortEnabled`). `--seed` no longer
   replaces global `Math.random`: the match owns one `RNG`, passed to the wall
   shuffle, the offline power rig (`ctx.rng`) and the bot brains, the same way
   `core.createMatchState` threads one through state.
5. **No replay log.** ✅ done — `engine/replay.js` implements the journal and
   verifier, and `server/journal.js` writes one per match when `SAKI_JOURNAL_DIR` is
   set. `scripts/verify-journal.mjs` replays a file through `core.js`. The writer is
   opt-in, so normal matches still do no file I/O. Reference has log/supervision
   (`log/`, `application.ex`).

Reference is more accurate as a spec: one interpreter, explicit `define_mod`
deviations, status-machine furiten/riichi/ippatsu, live multi-ruleset traffic.
It is less reliable as a runtime for us (new stack, own matcher bugs to own).

## 4. Fix plan (normal riichi first, in order)

### Phase 1: Rule Correctness & Critical Bug Fixes
- **Fix Riichi Furiten Leak**: ✅ done
  - Guarded `me.tempFuriten = false` in `engine/game.js` so it never resets if `me.riichi || me.doubleRiichi`; added `engine/helpers.js` `clearTempFuritenOnDraw`, called from `Table.playTurn`.
  - Regression tests in `engine/tests/furiten-riichi.test.js` assert that passing a winning discard under riichi prevents all subsequent ron attempts for that kyoku, while still allowing valid tsumo.
- **RNG Determinism Unification**: ✅ done
  - `engine/game.js` creates one `createRNG(seed)` per match and threads it through the kyoku `ctx`: the wall shuffle, `powerDraw`, bot discards/calls and the inline bot choices all draw from it.
  - Global `Math.random` is no longer replaced, so two matches in one process cannot share or leak RNG state; unseeded runs fall back to a `Math.random`-backed wrapper exactly as before.

### Phase 2: Deduplication & Single Source of Truth
- **Eliminate Tile/Wall Duplicate Code**: ✅ done
  - Removed the redundant `KINDS`, `norm`, `same`, `toCounts`, `toHandStr`, and `DORA_NEXT` from `engine/game.js`; it now imports from `engine/tiles.js`.
  - `engine/cli.js` is now a 38-line `eval`-only wrapper over `riichi`; its copy of `KINDS`/`buildWall` and the fourth `powerDraw` were deleted (KI-05).
- **Harmonize Rule Helpers**: ✅ done
  - Canonical copies of the abort/nagashi/waits/kuikae helpers live in `engine/helpers.js`.
  - Call candidacy and priority are shared in `engine/turn-core.js`
    (`callCandidates` / `arbitrateCalls`); both front-ends call them.

### Phase 3: Exact Pinning & Comprehensive Scoring Test Corpus
- **Pin Dependencies**: ✅ done — exact versions (`riichi` `1.2.0`, `syanten` `1.6.0`) in both `engine/package.json` and `server/package.json`.
- **Expand Test Vectors**: ✅ done
  - Landed as `engine/tests/rules.test.js` (36 tests: yaku, fu, dora/aka, flags, shibari, waits, aborts, kuikae, ankan, nagashi, oka/uma) plus `engine/tests/scoring-corpus.test.js` (24 table-driven fixtures: standard yaku, yakuman, and the 20/30/40/50/60-fu boundaries) and double-ron settlement cases in `server/test/settlement.test.js` (each winner is paid, the riichi pot and honba are not duplicated).
  - **Note:** this shipped as files, not the `engine/tests/rules/` fixture directory originally planned.

### Phase 4: Match Loop & Architecture Unification
- **Align Server & Offline Turn Loop**: ✅ done
  - The shared **numeric** rule values (start score, riichi stake, honba, noten schedule) now come from `engine/rules-config.js` and are read by both front-ends, with `engine/tests/rules-config-parity.test.js` failing if either reintroduces a literal copy.
  - Abortive draws are gated behind that config: both front-ends read `RULES.aborts` /
    `RULES.serverAborts` through `engine/match-flow.js abortEnabled`, and all five abort
    handlers now exist on both sides. Both sets enable all five, so the switch is
    behaviour-neutral today. See KI-04.
  - `engine/hand-driver.js` owns the hand-level order (`playHand`) and the per-turn
    skeleton (`playTurn`); `Table` and the CLI's `cliAdapter` are thin adapters over it.
    The boundary, the intentional divergences and the phase-5 cleanup are in
    [`turn-loop-merge.md`](turn-loop-merge.md).
- **Per-Turn Invariant Assertions**: ✅ done — `engine/invariants.js` (conservation via `DynamicPool.audit`, dead wall length, hand size, zero-sum scores).

### Phase 5: Deterministic Replay & Audit Journaling
- **Action Journaling**: ✅ done — `engine/replay.js` provides `record`/`verifyJournal` and replays through `core.js`; the server writes a journal per match when `SAKI_JOURNAL_DIR` is set (`server/journal.js`), and `scripts/verify-journal.mjs` checks one offline. Covered in `rules.test.js` (tamper rejection, wanpai swaps), `server/test/journal.test.js` (a real hand and a powered match) and `scripts/verify-journal.test.mjs`.
- **Replay runner**: ✅ done — `engine/replay.js`.

## 5. Implementation status

- Phase 1: gate in `engine/game.js` (own-draw clear) + `engine/helpers.js`
  `clearTempFuritenOnDraw` used by `Table.playTurn`; regression in
  `engine/tests/furiten-riichi.test.js` (5 tests).
- Phase 1 RNG: `--seed` creates one `createRNG` (mulberry32) per match, threaded
  through the kyoku `ctx` to the wall, powers and bots; global `Math.random` is left
  alone. `seed=7/kyoku=1` still reproduces byte-identical results (the golden
  fingerprint is unchanged).
- Phase 2: `game.js` tile/scoring helpers deleted, imported from
  `engine/tiles.js` + `engine/scoring.js`; abort helpers canonical in
  `engine/helpers.js` (`isSuufonRenda`, `isSuukaikanAbort`, `isNagashi`
  added + exported). `cli.js` was reduced to an `eval`-only wrapper, so its
  duplicate tile helpers and `powerDraw` copy are gone.
- Phase 3: exact pins (`riichi 1.2.0`, `syanten 1.6.0`, engine + server);
  `engine/tests/rules.test.js` (36 tests: yaku, fu, dora/aka, flags, shibari,
  waits, aborts, kuikae, ankan, nagashi, oka/uma) and the
  `engine/tests/scoring-corpus.test.js` fixture corpus (24 cases).
- Phase 4: `engine/rules-config.js` (RULES defaults; server aborts gated off),
  `engine/invariants.js` (conservation, dead wall, hand size, scores), and the
  shared turn driver `engine/hand-driver.js` (`playHand` / `playTurn`) that both
  front-ends adapt.
- Phase 5: `engine/replay.js` (journal + `verifyJournal` via `core.js`);
  covered in `rules.test.js` incl. tamper rejection, `server/test/journal.test.js`
  and the `verify-journal.mjs` CLI. *(Opt-in disk persistence: `SAKI_JOURNAL_DIR`.)*
- Full suite: `node --test tests/*.test.js` **475 pass / 0 fail** + `game.js --selftest`
  **48 checks**; server `npm test` **160 pass / 0 fail**; dev scripts `npm run test:scripts`
  **13 pass**. (Use the glob form — a bare
  directory argument is rejected by Node 22; see `docs/development.md` §5.)

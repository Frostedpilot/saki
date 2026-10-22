# Turn-loop merge (KI-04, audit item 23)

**Status: deterministic layers merged, and the pure single-turn decisions (turn start,
discard bookkeeping, own kan, call candidates, call priority) are now shared; interactive
scheduling is not merged, on purpose.** The *rule* layer — including the canonical
hand→next-hand outcome — is shared. The *interactive turn scheduling* is not. This document
records the exact boundary, the divergences that make a naive merge unsafe, and the phased
plan if it is ever attempted.

## What "shared" means today

Both front-ends (`engine/game.js` and `server/table.js`) already call the same code for
everything below. A change here cannot land in one side only:

| Layer | Module | Notes |
| --- | --- | --- |
| Rule predicates | `engine/helpers.js` | waits, furiten, ron, bot brains, chis, aborts, nagashi, oka/uma, riichi eligibility |
| Single-turn decisions | `engine/turn-core.js` | turn start/tenhou window, discard + ippatsu bookkeeping, own-kan availability, call candidates, call priority |
| Hand-level driver | `engine/hand-driver.js` | `playHand` / `playTurn` own turn order and the draw→tsumo/kan/riichi/discard→call skeleton; the server is wired, CLI migration next |
| Hand transition | `engine/match-flow.js` | `handOutcome` (canonical) and `postHandFlow` (adapter); dealer repeat, honba, kyoku |
| Score arithmetic | `engine/match-flow.js` | `winPayments`, `manganPayment`, `nagashiPayments`, `notenPayments` |
| Abort switch | `engine/match-flow.js` | `abortEnabled` (`RULES.aborts` / `RULES.serverAborts`) |
| Dead-wall layout | `engine/match-flow.js` | `doraIndicatorSlots` |
| Numeric config | `engine/rules-config.js` | both front-ends read it; pinned by `rules-config-parity.test.js` |
| Conservation | `engine/invariants.js` | wanpai-aware audit (server only, behind `SAKI_INVARIANTS`) |

What is **not** shared is the loop that asks "whose turn is it, what may they do, and what
happens next". That loop is a *driver*, not a rule. The pure decisions inside it are shared
(`turn-core`); the scheduling is not:

- **Offline (`game.js main()`)** — a synchronous `while`, with human decisions read from
  `readline` via `await ask(...)`, a pre-shuffled wall array drawn from the tail, and the
  legacy inline `powerDraw` rig.
- **Network (`table.js Table`)** — an async phase machine (`TURN_ACT → CALL_WINDOW →
  CALL_DISCARD → ROUND_END`) whose decisions arrive as WebSocket actions through
  `request()`/`submitAction()`, a `DynamicPool` weighted draw, and the
  `engine/powers` dispatcher.

Merging those two drivers means inventing a third abstraction that both a CLI and a
WebSocket server drive. That is a rewrite of roughly 500 lines on each side, and the two
sides disagree on rules in ways that are currently **intentional**. It is not a mechanical
extraction.

## Intentional divergences (do not "fix" one side blindly)

These are the places where the drivers behave differently. Each is a rules decision, not a
copy/paste accident. A shared loop must either preserve them as explicit policy or the two
sides must agree on one rule first.

| Area | Offline | Server | Why it exists |
| --- | --- | --- | --- |
| Kyuushu prompt | human may abort or play on | humans auto play on (CPU may abort) | no deal-time prompt exists on the wire |
| Agari-yame / enchousen | dealer is prompted; overtime persisted explicitly | auto-end if dealer leads; overtime exits on rotation | human vs bot match control |
| Powers | inline `powerDraw` rig (kuro/saki/yuuki/koromo/hisa) | `engine/powers` roster + FlowManager | two different feature sets |
| Draw model | pre-shuffled array, `pop()` | `DynamicPool` weighted sampling | deterministic replay vs weightable draws |
| `winBy` shape | `{type, from, wins[], tile, tag}` / `{type:'tsumo', r}` | `{type, from, hits[], tile, flags}` / `{type:'tsumo', seat, ...}` | each is consumed by its own settlement code |
| Turn clock | none (blocks on `ask`) | `turnClockFor` + `turnTimer` (advisory) | CLI vs network |
| Invariants | `assertConserved` after deal/discard | `assertConserved` behind `SAKI_INVARIANTS` | test-time only online |

Anything in that table that changes is a **rules change**, and should be reviewed as one.

The **nagashi dealer** question was resolved in favour of the server's reading: nagashi
mangan is a win, so the dealer repeats only when the dealer is one of the nagashi seats (a
tenpai dealer does *not* also repeat if someone else nagashi'd). `handOutcome` now encodes
that once for both drivers.

The **first-lap aborts** are now ordered identically. Suufon-renda requires that no call
was made, so both drivers check it after the call window — a call on the 4th first-lap
discard voids it. Suucha-riichi is unaffected by the ordering: when all four players are in
riichi, none of them can pon/chi/kan, so the only possible claim is ron, which takes
precedence in both.

The **chombo** is now a penalty on both sides, not a refusal. An ankan after riichi that
changes the waits is declarable: the server marks it (`classifyHumanKan` →
`{kind:'ankan', chombo:true}`), `doOwnKan` warns the offender, does **not** apply the kan,
and settles the same mangan tsumo penalty + replay as `game.js`. Honba is unchanged and
the riichi sticks carry (the shared `handOutcome({kind:'chombo'})` transition). Unknown
wait snapshots fall into the same branch rather than silently legalising the kan.
Kakan-in-riichi is still refused — a riichi hand has no open pon, and `game.js` refuses it
too rather than treating it as a chombo.

The **ippatsu expiry** is now unified as well. The server used to clear ippatsu only on a
call, which could leave it live for the rest of the hand; it now uses the standard
declarer-discard model through `turn-core.resolveDiscard`: the declaring discard itself
does not clear ippatsu, the declarer's next discard does, and any call clears it earlier
(`clearAllIppatsu`). This is a rule change, not a mechanical extraction.

## If the merge is attempted: required adapter

A shared driver would look like `playHand(adapter, matchState)`, where the adapter owns all
I/O and the environment:

```
deal()                         -> initial hands, dead wall, indicators
draw(seat, source)             -> tile | null   (source: 'wall' | 'rinshan')
score(seat, flags)             -> scorer result
prompt(seat, request)          -> decision      (CLI readline or WebSocket request)
broadcast(event)               -> void          (console or ev* messages)
applyCall(seat, kind, tiles)   -> void
settle(outcome)                -> applied scores
now() / wait(ms)               -> void          (bot pacing, turn clock)
```

The shared module would own: turn order, draw → kan/tsumo/riichi/discard, the ron window
and its seat ordering, the call-priority arbitration, kan/rinshan bookkeeping, abort
checks, and the hand outcome. The adapter would own every `await`, every message, and the
power/draw model.

The hard part is the **concurrent call window**: the server polls all candidates at once and
resolves early on a ron, while the CLI asks them in seat order. The adapter must expose a
`promptMany(seats, request)` primitive for both.

## Phased plan (each phase keeps the suite green)

1. **Rule parity first.** Make the two sides agree on every divergence in the table above,
   or mark each as an explicit config policy (`RULES.*`). *Done for the numeric ones:
   `minWallForRiichi`, `maxKan`, `rinshanSlots`; the rinshan temp-furiten clear; the
   agari-yame test (`dealerLeads`); and chombo-as-penalty, now settled through the shared
   `handOutcome` transition.*
2. **Canonical outcome.** `handOutcome({kind, winnerSeats, tenpaiSeats, nagashiSeats,
   dealer})` returns `{honba, keepDealer, kyokuRepeat}`. **Done.** `game.js` calls it directly
   for chombo/abort/win/exhaustive; `server/table.js` keeps its `postHandFlow` call, which
   now delegates to `handOutcome`, so there is one policy. Match-END policy (tobi,
   agari-yame, enchousen) stays at the driver because the CLI prompts and the server does
   not.
3. **Single-turn core.** Extract `beginTurn` / `resolveDiscard` / `resolveCalls` as pure
   functions over a canonical state, still driven by each loop. This is where most of the
   duplication is. **Done.** `engine/turn-core.js` owns `beginTurn` (first-draw/tenhou
   window, last draw, tsumo flags), `resolveDiscard` (first-lap accumulation and ippatsu
   expiry), `kanOptions` (own kan), `callCandidates` (ron/pon/daiminkan/chi) and
   `arbitrateCalls` (priority). Both drivers call it. What remains is the scheduling
   itself: phase 4.
4. **Shared driver.** One `playHand(adapter)` and two thin adapters. **Started and
   server-wired:** `engine/hand-driver.js` owns the hand-level loop and the per-turn
   skeleton (`playHand` / `playTurn`), and `Table.playTurn` is now a thin adapter
   (draw, score, prompt, power hooks, settlement shape). The CLI still has its inline
   loop; porting it is the remaining phase-4 work.
5. **Delete the old loops** and the parity guards that existed only to keep them honest.

Phases 1–3 are incremental and reviewable. Phase 4 is the 2–3 day rewrite; it should be its
own branch, and it will almost certainly change at least one rule.

## Decision

The deterministic layers are merged, including the hand outcome, the single-turn decisions
and the ippatsu rule. The interactive drivers are deliberately separate: they encode
genuinely different control models (blocking CLI vs awaited network phases) and a few
still-different rules (powers). Unifying the scheduling for its own sake would add a third
abstraction and risk rule regressions with no player-visible benefit. If a specific
divergence is wrong, fix that rule in both front-ends — that is the high-value work, and it
is what the parity guards in `engine/tests/rules-config-parity.test.js` protect.

See also: [KI-04](known-issues.md#ki-04), [conventions §4.3](conventions.md).

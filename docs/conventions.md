# Code conventions

There is **no linter, formatter, `.editorconfig`, or `CONTRIBUTING.md`** in this repo —
the rules below were reverse-engineered from the existing code so that new code looks
like old code. Nothing here is enforced by tooling.

---

## 1. Module system — the one hard split

| Directory | System | Config |
| --- | --- | --- |
| `engine/` | **CommonJS** | `"type": "commonjs"` in `engine/package.json` |
| `server/` | **CommonJS** | `"type": "commonjs"` in `server/package.json` |
| `web-client/` | **ES modules + TypeScript** | `"type": "module"`, `tsconfig.json` with `"strict": true` |

Do not mix. Use `require`/`module.exports` in `engine/` and `server/`;
`import`/`export` in `web-client/`. There is no transpiler for the first two — they
run directly on Node.

### `'use strict'`

Present at the top of every file in `server/` (`index.js`, `room.js`, `protocol.js`,
`helpers.js`, `yaku-map.js`) and in `engine/rules-config.js`, but **not** consistently
in `engine/` (`game.js`, `core.js`, `tiles.js` omit it). Node defaults to sloppy
mode for CommonJS, so this is a real behavioural difference, not decoration. Prefer
including it in new `engine/` files for consistency with `server/`.

### TypeScript in `web-client` only

`engine/` and `server/` are plain JavaScript with JSDoc-style block comments used as
design documentation. The comment block at the top of `engine/powers/rosters/kiyosumi.js`
is a good example of the house style: a file-level contract, not per-line narration.

`web-client/tsconfig.json` sets `noEmit` + `strict`; `tsc` runs in `npm run build`.
Types for Vite-specific imports (notably `*.svg?raw`) live in
`web-client/src/vite-env.d.ts` — extend that file rather than adding local declarations.

---

## 2. Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files | `kebab-case.js`, test files `<subject>.test.js` | `dynamicPool.js`, `furiten-riichi.test.js` |
| Classes | `PascalCase` | `Room`, `Table`, `PowerDispatcher`, `DynamicPool`, `GameStore` |
| Functions / vars | `camelCase` | `createMatchState`, `sampleRinshan`, `getKuikaeBannedIndices` |
| Constants | `SCREAMING_SNAKE_CASE` | `RINSHAN_WAIT_WEIGHT = 10.0`, `BOT_MIN_DELAY_MS`, `DEAD_WALL_LENGTH` |
| Server events (wire) | `PascalCase` in an object key | `TileDrawn`, `RoundWon`, `SuperpowerIndicator` |
| Client-side event aliases | `ev` + PascalCase | `evSuperpowerIndicator` |
| State bundles | `PascalCase` + `State` | `TableState` |
| Power hooks | `create<Name>Hooks` | `createSakiHooks`, `createYuuHooks` |
| Power registry keys | kebab or short lowercase | `saki`, `saki-normal`, `yuuki` |

Field names crossing the wire are **snake_case** (serde convention). Field names inside
the engine are **camelCase**. Don't mix them within a file.

---

## 3. Comments

House style is a **file-header contract comment**, then sparse section banners:

```js
// tiles.js — <what this file owns>.
// <invariants, units, and any non-obvious constraint>.
// Simplifications: <what is deliberately NOT handled>.

// ---------- tiles (shared: engine/tiles.js) ----------
```

Inside functions, comment the *why* and the *rule*, never the mechanics. Refer to
`RULES` (`engine/rules-config.js`) rather than restating magic numbers, and refer to
spec sections as `Spec §5.3` (see `engine-design.md`).

---

## 4. Engine architecture rules

These are enforced by convention and by tests, and are the things most likely to break
silently if violated.

### 4.1 Character code reads state, never mutates it

The single most important rule in the repo, stated at the top of every roster file:

> Character code only **reads** state and **returns** weights / events / plans. It never
> mutates `pool.counts`, hands, scores, or the RNG directly.

There are exactly **three sanctioned engine-side mutations**:

- `pool.reserveSlot(...)` — reserve an abstract anchor in the live wall
- `core.exchangeDeadWallSlot(...)` / `core.sampleRinshan(...)` — physical rinshan slots,
  keeping wanpai at exactly 14 tiles
- `flow.consume(...)` — spend Flow

Sampling always happens engine-side in `DynamicPool`, which keeps games deterministic
and replayable. A roster that reaches into `pool.counts` will break tile conservation
(`engine/invariants.js`) and determinism (`engine/replay.js`).

### 4.2 A registry with no hooks behaves identically to no powers

`PowerDispatcher` defaults everything: empty registry ⇒ all draw weights `1.0` ⇒
uniform sampling ⇒ physically identical to a shuffled deck. `engine/powers/index.js`'s
header states this as the invariant. `engine/tests/powerArchitecture.test.js` pins it.

**Corollary:** every hook must be defensive. The dispatcher already wraps hook calls in
`try/catch` and falls back to the default (`drawWeight` → `1.0`, `broadcastPlayerKan` →
ignore). Write hooks that assume nothing about state shape.

### 4.3 The two rule implementations

| | Offline | Network |
| --- | --- | --- |
| Driver | `engine/game.js` | `engine/core.js` + `server/room.js` |
| Wall | pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |
| Powers | **inline simplified `powerDraw()`** — *not* the roster framework | full `PowerDispatcher` |
| Aborts | all five | none |

Shared logic lives in `engine/tiles.js`, `engine/scoring.js`, `engine/rng.js`,
`engine/rules-config.js`, and `server/helpers.js`. **When you change a rule, decide
which implementation you are changing and say so in the commit** — or better, move it
into a shared module, which is what `server/helpers.js` was extracted for.

`engine/cli.js` still re-declares `KINDS` and re-implements `buildWall` locally instead
of importing `tiles.js`. This duplication is real and unfixed.

### 4.4 Rules are data

Numeric rule values belong in `engine/rules-config.js` (`RULES`), not inline. Both
`game.js` and `server/room.js` read it. Abort flags are paired — `RULES.aborts` for the
offline engine, `RULES.serverAborts` for the server — with the comment "flip a flag only
together with its handler".

---

## 5. Testing conventions

- Node's built-in runner only. `const { test } = require('node:test')`,
  `const assert = require('node:assert/strict')`. No Jest, Mocha, or Vitest.
- Files: `engine/tests/<subject>.test.js`, `server/test/<subject>.test.js`.
- Character suites are named after the roster: `saki.test.js`, `koromo.test.js`.
  Variants get a suffix: `saki-normal.test.js`, `saki-full.test.js`.
- Bug-hunting suites are named for intent: `edge.test.js`, `crossCharacter.test.js`,
  `furiten-riichi.test.js` (a regression suite — name it after the bug it pins).
- Share setup through `engine/tests/helpers/sim.js` rather than copy-pasting table setup.
- **Regression tests must name the bug.** `furiten-riichi.test.js` is the model: it
  exists because of a specific fix, and it stays so the bug cannot return.
- Use `--seed N` for anything stochastic; never assert on unseeded output.

Run with `npm test` (or `node --test tests/*.test.js` directly — the glob is required;
see [`development.md`](development.md#5-testing)).

---

## 6. Client conventions (`web-client/`)

- **lit-html, not a framework.** Components are pure `render*` functions returning a
  `TemplateResult`. No class components, no hooks, no VDOM library.
- One component per file in `src/components/`, exported as `renderX`.
- `src/state/store.ts` is the single store. Components receive state and emit intents;
  outbound protocol calls live on the store. Do not open a second WebSocket or stash
  game state in a component.
- `src/net/socket.ts` owns reconnection and connection status. Components read status
  from the store, they do not manage sockets.
- SCSS in `src/styles/`; `main.scss` `@use`s the others and holds the design tokens.
  Custom properties (`--table-size`, `--tile-width`) drive responsive layout.
- Tile faces come from the FluffyStuff sprite sheet via `svg-tiles.ts`, injected into
  the DOM once. Use `renderTile(tile, opts)`; do not hand-write tile markup.
- Prefer normalising tiles through `tiles/tile-utils.ts` (`normFace`, `DORA_NEXT`,
  `tilesToCounts`) over ad-hoc string handling.

---

## 7. Adding a character

### Step 1 — write the spec first

Copy the 7-section template in [`characters/README.md`](characters/README.md) into
`docs/characters/NN_<name>.md`. The sections are: Metadata & Archetype, Flow Gauge
Economy, Thematic Passive, Tiers 1–4, Hooks, Client/Server HUD events, Test scenarios.
**Match the existing spec numbers to the code**, and if you deliberately change a
mechanic, update `abilities.md` in the same change — divergence between those two docs
is the repo's main documentation problem.

### Step 2 — implement the roster

Create `engine/powers/rosters/<key>.js`:

```js
// rosters/<key>.js — <Character> (<Power Name>).
// Pattern: character code only READS state and RETURNS weights/events/plans.
// It never mutates pool.counts, hands, scores, or RNG directly.
const { norm, DORA_NEXT } = require('../../tiles');
const { shantenOf, hairiOf } = require('../trajectoryPlanner');
const { scalePassiveWeight } = require('../awakening');

const START_SCORE = 25000;
const TIER1_COST = 25; const TIER2_COST = 50;
const TIER3_COST = 100; const TIER4_COST = 150;

function create<Name>Hooks(seat) {
  return {
    meta: { type: 'flow' },           // omit or 'normal' for a passive power
    onPreDeal(ctx) {},
    onWallSetup(ctx) {},
    getTierInfo(state) { return [/* { tier, name, cost, canAfford, canActivate } */]; },
    onTurnStart(state, opts) { return { activated: false, reason: '…' }; },
    onPowerDraw(tile, state, trajectory) { return 1.0; },   // >= 0, default 1.0
    applyFieldAura(drawSeat, weights, state) { return weights; },
    getTurnClock(state) { return 10; },
    onKanDeclared(state, opts) {},
    onPlayerKan(kanSeat, state) {},
    onPostDraw(tile, state) {},
    onSettlement(result, state) {},
  };
}

module.exports = { create<Name>Hooks };
```

**The hook contract** (`engine/powers/index.js`):

| Hook | Phase | Return value |
| --- | --- | --- |
| `onPreDeal(ctx)` | 0 — before deal | anything / `null` |
| `onWallSetup(ctx)` | 1 — wall + reservations | anything / `null` |
| `getTierInfo(state)` | UI | `[{ tier, name, cost, canAfford, canActivate }]` |
| `onTurnStart(state, opts)` | 2 — turn opens | `{ activated: false, reason: '…' }` |
| `onPowerDraw(tile, state, trajectory)` | 2 — per tile | **number `>= 0`**, default `1.0` |
| `applyFieldAura(drawSeat, weights, state)` | 2b — opponent weights | new weights object |
| `getTurnClock(state)` | 2c | seconds, default `10` |
| `onKanDeclared(state, opts)` | 3 — kan resolved | `{ activated, reason }` |
| `onPlayerKan(kanSeat, state)` | any — broadcast | ignored |
| `onPostDraw(tile, state)` | after draw | ignored |
| `onSettlement(result, state)` | 4 — hand over | ignored |

Declare `meta: { type: 'normal' }` for a **normal-type** passive: the FlowManager pins
the seat at 0, all gauge ops become no-ops, and the client renders a `PASSIVE` pill
instead of a meter. Do not fake a normal power as a flow power with zero costs.

### Step 3 — register it on the server

Add a `try/catch` require to the `ROSTERS` block in `server/room.js` (~line 24):

```js
try { ROSTERS.<key> = require('../engine/powers/rosters/<key>').create<Name>Hooks; }
catch { /* roster missing */ }
```

Then add the key to the client's `AVAILABLE_CHARACTERS` in
`web-client/src/components/lobby-view.ts`.

### Step 4 — test it

Add `engine/tests/<key>.test.js`. Use `engine/tests/helpers/sim.js` to script hands.
Pin at least: the passive weight delta, each tier's activation gate and Flow cost, and
that the power with an empty registry is a no-op.

### Step 5 — update the docs

Update `docs/abilities.md`, `docs/characters/README.md` (index), and this file's roster
table if the character uses a new primitive.

---

## 8. Things not to do

- **Do not cite `file:line` in docs.** Cite symbols — `room.js` `resolveCallWindow`.
  The ~40 existing line citations in `engine-implementation.md` are already stale.
- **Do not add a second rule implementation.** Extend `server/helpers.js` or
  `engine/rules-config.js` instead.
- **Do not mutate pool/hand/score from a roster** — return weights and let
  `DynamicPool` sample.
- **Do not add a root `package.json`** expecting it to work. There are no workspaces;
  each package installs independently.
- **Do not commit `node_modules/`, `dist/`, or `reference/`** — all gitignored.
- **Do not treat `server/public/` as build output.** It is a vendored upstream WASM
  client tracked in git; nothing here regenerates it.

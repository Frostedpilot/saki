# Documentation index

Saki's docs predate the code in places. This page exists so you know **which document
to believe** before you read the wrong one.

## Authority order

When two documents disagree, resolve it in this order:

1. **The code.** Then the test that pins it.
2. **`docs/characters/NN_*.md`** — per-character specs. These are the most carefully
   maintained and they match the roster constants in `engine/powers/rosters/`.
3. **`docs/architecture-comparison.md`** §5 "Implementation status" — records which
   planned fixes actually landed.
4. **`docs/engine-implementation.md`**, **`docs/engine-design.md`** — good prose, but
   many `file:line` citations and several numbers are stale.
5. **`docs/abilities.md`** — **design intent, not current behaviour.** Multiple
   mechanics here were redesigned; the pre-redesign numbers remain.

---

## Core documents

| Doc | Lines | Authority | Notes |
| --- | --- | --- | --- |
| [`../README.md`](../README.md) | — | current | Quick start, layout, rules-variant table |
| [`development.md`](development.md) | — | current | Setup, run, test matrix, env vars, troubleshooting |
| [`protocol.md`](protocol.md) | — | current | Protocol v6 wire contract |
| [`conventions.md`](conventions.md) | — | current | Code style, module boundaries, how to add a character |
| [`known-issues.md`](known-issues.md) | — | current | Structural fragility register + doc rot |
| [`provenance.md`](provenance.md) | — | current | The vendored prebuilt WASM client and third-party art: what is verified, what is unknown |
| [`engine-implementation.md`](engine-implementation.md) | 384 | mostly current | How a game runs end to end. **`file:line` citations are 30–100 lines stale.** |
| [`engine-design.md`](engine-design.md) | 269 | design | The 6 primitives, Flow economy, lifecycle. Some numbers and the roster tree are wrong. |
| [`architecture-comparison.md`](architecture-comparison.md) | 127 | current | Ours vs upstream `riichi_advanced`. Best-maintained doc here. |

## Character documents

| Doc | Authority | Notes |
| --- | --- | --- |
| [`characters/README.md`](characters/README.md) | index | Spec template. Lists 6 of the 8 shipped powers — `saki-normal` and `yuu` (Achiga) have no spec. |
| [`characters/01_saki_miyanaga.md`](characters/01_saki_miyanaga.md) | canonical | Saki Miyanaga — matches `rosters/kiyosumi.js` |
| [`characters/02_nodoka_haramura.md`](characters/02_nodoka_haramura.md) | canonical | Nodoka Haramura — matches `rosters/nodoka.js` |
| [`characters/03_yuuki_kataoka.md`](characters/03_yuuki_kataoka.md) | canonical | Yuuki Kataoka — matches `rosters/yuuki.js` |
| [`characters/04_mako_someya.md`](characters/04_mako_someya.md) | canonical | Mako Someya — matches `rosters/mako.js` |
| [`characters/05_hisa_takei.md`](characters/05_hisa_takei.md) | canonical | Hisa Takei — matches `rosters/hisa.js` |
| [`characters/06_koromo_amae.md`](characters/06_koromo_amae.md) | canonical | Koromo Amae — matches `rosters/koromo.js` |

**Undocumented implementations.** Two shipped powers have no spec at all:

| Module | Power | What it is |
| --- | --- | --- |
| `engine/powers/rosters/saki-normal.js` | `saki-normal` | Saki's *normal-type* variant — "Ridge Bias / Ridge Resonance": always-on passive, no Flow gauge (`KAN_BIAS_WEIGHT = 4.0`) |
| `engine/powers/rosters/achiga.js` | `yuu` | Yuu Matsumi (Achiga Girls Academy) — normal-type passive, Manzu + Chun bias |

## Reference documents

| Doc | Notes |
| --- | --- |
| [`abilities.md`](abilities.md) | All ~28 documented characters — 8 implemented, ~20 design intent. Numbers now reconciled with the specs. |
| [`saki-characters.md`](saki-characters.md) | Franchise lore and full cast. Not an implementation doc. |
| [`reference-riichi-advanced.md`](reference-riichi-advanced.md) | Notes on the upstream Elixir/Rust/Z3 engine. **All ~60 cited paths live under `reference/`, which is gitignored and absent from a fresh clone.** |


---

## Reconciled: `abilities.md` vs the character specs

The character specs describe a post-redesign pass that `abilities.md` originally missed.
**This has now been reconciled** — `abilities.md` carries the spec values, each
implemented character links its canonical source, and redesigned tiers note what they
replaced.

The table is kept as a record of what changed. If you find a discrepancy between
`abilities.md` and a spec, **the spec still wins** — treat it as a new bug and fix
`abilities.md`.

| Mechanic | Was (pre-redesign) | Now — spec + code |
| --- | --- | --- |
| Saki — passive tolerance | within +20% of start score | **within 1500 pts** of 25,000 (`01`, `kiyosumi.js`) |
| Saki — defensive Flow bonus | +20% | **+50% bonus** → +3.0% instead of +1.5% (`01`) |
| Saki — triplet draw weight | +15% | **×1.35** (`01`) |
| Nodoka — max-ukeire bonus | gauge doubles | **+3.5%**, not +1.5% (`02`) |
| Nodoka — T1 duration | next 2 turns | **next 3 draws** (`02`) |
| Nodoka — T2 | 90%-accurate, grants Ron immunity | **intersection of 100% safe tiles**, no Ron immunity (`02`) |
| Nodoka — T4 multiplier | *(missing)* | **×4.0** (`02`) |
| Yuuki — East/South flow | +50% / −50% | **+3.0% / +0.75%** (`03`) |
| Yuuki — speed-tile weight | +25% | **+30%** (`03`) |
| Yuuki — turn clock | 4 s | **6 s** (`03`, `engine-design.md`) |
| Yuuki — T1 window | turns 1–6 | **turns 1–5** (`03`) |
| Yuuki — T4 | 75% forced opponent deal-in | **redesigned out** ("No Mind Control", `03`) |
| Koromo — T1 window | 2 s turn decision | **5 s threshold, −5% Flow/sec** (`06`) |
| Koromo — T3 wall gate / multiplier | 15 tiles / *(missing)* | **≤20 tiles / ×2.5** (`06`, `koromo.js`) |
| Koromo — T4 wall gate | *(missing)* | **≤14 tiles** (`06`, `koromo.js`) |
| Hisa — hell-wait multiplier | *(missing)* | **×3.0** (`05`) |
| Hisa — T1 | declares a "Bluff Riichi" | **redesigned out** — "Phantom Intimidation", no Riichi (`05`) |
| Hisa — T3 | 75% | **70%** (`05`) |
| Hisa — T4 | wall <20, 1000-pt cap, 2 furiten rotations, Haitei 90% | **wall <25, 50% mitigation, 4 s timer, Haitei 85%** (`05`, `hisa.js`) |
| Mako — flow ramp | +15%/turn from T7 | **+2.5% at T7, +0.5%/turn** (`04`) |
| Mako — Spectacle Removal | −15% def / +30% read | **−10% def / +35% read** (`04`) |
| Yuu Matsumi | "Thermal Affinity" | **"Hot Dams"** (Manzu + Chun), `MANZU_CHUN_BIAS = 1.35` (`achiga.js`) |

`abilities.md` also documents ~28 characters against 8 roster modules. It now carries a
banner separating the two, and unimplemented entries with missing values are marked
`[unspecified]` rather than left as broken sentences.

---

## Conventions used by these docs

- `path/to/file.js` — a real path in this repo. If it is prefixed `reference/`, it only
  exists if you cloned the upstream engine yourself, and citations there are unverified.
- **Cite symbols, not line numbers.** Every `file:line` citation that existed here went
  stale the moment code moved; prefer `` `table.js` `resolveCallWindow` ``. The
  `file:line` remaining in `known-issues.md` is quoting the old text on purpose.
- Anything marked **[OPEN]** or ⚠️ in `known-issues.md` should not be trusted without
  checking the code. Part B is fully resolved; Part A (structural fragility) is not.

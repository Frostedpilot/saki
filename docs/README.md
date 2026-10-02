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
| `engine/powers/rosters/saki-normal.js` | `saki-normal` | Saki's *normal-type* variant ("Ridge Resonance") — always-on passive, no Flow gauge |
| `engine/powers/rosters/achiga.js` | `yuu` | Yuu Matsumi (Achiga Girls Academy) — normal-type passive, Manzu + Chun bias |

## Reference documents

| Doc | Notes |
| --- | --- |
| [`abilities.md`](abilities.md) | All ~28 documented characters. **Partly superseded** — see below. Contains ~18 sentences with missing numeric values. |
| [`saki-characters.md`](saki-characters.md) | Franchise lore and full cast. Not an implementation doc. |
| [`reference-riichi-advanced.md`](reference-riichi-advanced.md) | Notes on the upstream Elixir/Rust/Z3 engine. **All ~60 cited paths live under `reference/`, which is gitignored and absent from a fresh clone.** |

---

## Where `abilities.md` contradicts the character specs

The character specs describe a post-redesign pass. `abilities.md` still carries the
original numbers. If you are implementing or debugging, trust this table:

| Mechanic | `abilities.md` says | Spec + code say |
| --- | --- | --- |
| Saki — passive tolerance | within **+20%** of start score | within **1500 pts** (`01`, `rosters/kiyosumi.js`) |
| Saki — triplet draw weight | **+15%** | **x1.35** |
| Nodoka — max-ukeire bonus | gauge **doubles** | **+3.5%** (not +1.5%) (`02`) |
| Nodoka — T1 duration | next **2** turns | next **3** draws (`02`) |
| Nodoka — T2 | 90%-accurate safe discard, grants **Ron immunity** | intersection of safe tiles, **no Ron immunity** (`02`) |
| Yuuki — T1 window | turns 1-6 | turns **1-5** (`03`) |
| Yuuki — turn clock | **4 s** | **6 s** (`03`, `engine-design.md`) |
| Yuuki — T4 | 75% chance opponents deal into her wait | **redesigned out** ("No Mind Control", `03`) |
| Koromo — T1 window | **2 s** turn decision | **5 s** threshold, -5% Flow/sec (`06`) |
| Koromo — T3 wall gate | 15 tiles | **<=20** (`06`, `rosters/koromo.js`) |
| Hisa — T1 | declares a "Bluff Riichi" | **redesigned out** — "Phantom Intimidation", no Riichi (`05`) |
| Hisa — T3 | 75% | **70%** (`05`) |
| Hisa — T4 | wall <20, 1000-pt cap | wall **<25**, **50%** mitigation, 4 s timer (`05`, `rosters/hisa.js`) |
| Mako — flow ramp | +15%/turn from T7 | **+2.5%** at T7, +0.5%/turn (`04`) |
| Mako — Spectacle Removal | -15% def / +30% read | **-10% def / +35% read** (`04`) |
| Yuu Matsumi | x1.35 | x1.35 — but named "Hot Dams (Manzu + Chun)", not "Thermal affinity" |

---

## Conventions used by these docs

- `path/to/file.js` — a real path in this repo. If it is prefixed `reference/`, it only
  exists if you cloned the upstream engine yourself.
- **Cite symbols, not line numbers.** The existing `file:line` citations in
  `engine-implementation.md` went stale the moment code moved; prefer
  `` `room.js` `resolveCallWindow` ``.
- Anything marked **[stale]** in `known-issues.md` should not be trusted without
  checking the code.

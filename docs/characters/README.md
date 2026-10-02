# Saki PvP Mahjong: Character Implementation Specifications

This directory contains technical implementation specifications for the Saki
supernatural Mahjong engine's characters.

> **Status:** these are **design specifications**, not production-ready code. They mix
> concrete numbers (which do match `engine/powers/rosters/`) with illustrative
> pseudo-code that is *not* a transcription of the shipped implementation. Treat the
> numbers as canonical and the code blocks as sketches. The real contract is the hook
> API in `engine/powers/index.js`; see [`../conventions.md`](../conventions.md#adding-a-character).
>
> **Coverage:** 6 of the 8 shipped powers have a spec. `saki-normal` and `yuu` do not —
> see the gap list below.

Every character specification maps directly to the architecture defined in [docs/engine-design.md](../engine-design.md):
1. **The Schrödinger’s Wall:** Dynamic weighted sampling from the finite 136-tile pool (`remainingPool`).
2. **The Hand Trajectory DAG:** Path planning toward target archetypes with bridge tile tracking.
3. **The 4-Phase Lifecycle Hooks:** `onPreDeal`, `onWallSetup`, `onPowerDraw`, and `onSettlement`.
4. **The Flow Gauge Economy:** 0–150% meter management.
5. **The 6 Ability Primitives:** Trajectory Shapers, Slot Reservers, Field Enforcers, Perception Warpers, Tempo Economists, and Settlement Modifiers.

---

## Character Index

### Kiyosumi High (Nagano)
* [01. Saki Miyanaga](./01_saki_miyanaga.md) - *Score Equilibrium, Wanpai Rinshan Chaining, Suukantsu Bounded Climax*
* [02. Nodoka Haramura](./02_nodoka_haramura.md) - *Digital Efficiency, 5-Block Uke-ire Engine, Nodocchi EV Sight*
* [03. Yuuki Kataoka](./03_yuuki_kataoka.md) - *East-Round Blitz, Taco Rush Turn Pressure, South-Round Sugar Crash*
* [04. Mako Someya](./04_mako_someya.md) - *Turn 7+ Parlor Archive, Historical River Matching, Discard Tempo Choke*
* [05. Hisa Takei](./05_hisa_takei.md) - *Bad-Wait Multipliers (Jigoku-machi), Phantom Threat Aura, Late-Wall Dominance*

### Ryuumonbuchi High (Nagano)
* [06. Koromo Amae](./06_koromo_amae.md) - *Lunar Phase Resonance, Shanten Suppression Mire, Haitei Anchor & Counterplay*

### Implemented but not yet specified

Two shipped roster modules have no specification document yet. Their behaviour is
fully described in code and partially in `../abilities.md`:

| Registry key | Roster file | What it is |
|---|---|---|
| `saki-normal` | `engine/powers/rosters/saki-normal.js` | Saki Miyanaga, normal-type variant — "Ridge Bias / Ridge Resonance". Always-on passive, no Flow gauge. `KAN_BIAS_WEIGHT = 4.0`. |
| `yuu` | `engine/powers/rosters/achiga.js` | Yuu Matsumi (Achiga Girls Academy) — normal-type passive boosting Manzu + Chun draws by `MANZU_CHUN_BIAS = 1.35`. |

---

## Specification Template Structure

Each character specification document follows this standard structure:
1. **Character Metadata & Core Archetype**
2. **Flow Gauge Economy** (Generation, thematic accelerators, drain conditions)
3. **Thematic Passive Implementation**
4. **Active Skills (Tiers 1–4)** (Preconditions, activation point, state mutations, and fallbacks)
5. **Lifecycle Hooks Implementation** (`onPreDeal`, `onWallSetup`, `onPowerDraw`, `onSettlement`)
6. **Client-Server Protocol & HUD Events**
7. **Deterministic Unit Test Scenarios**

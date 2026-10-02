# Saki PvP Mahjong: Character Implementation Specifications

This directory contains concrete, production-ready technical implementation specifications for each character in the *Saki* supernatural Mahjong engine.

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

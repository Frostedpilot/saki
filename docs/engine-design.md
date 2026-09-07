# Saki Mahjong Supernatural Engine: Technical Architecture & Design Specification

## 1. Executive Summary & Core Philosophy

This specification outlines an extensible, deterministic, and balanced game engine designed to power the supernatural Mahjong abilities of the *Saki* universe.

### Core Paradigms
1. **The "Schrödinger’s Wall" (Lazy Evaluation via Dynamic Weighted Sampling):** The live wall is never pre-shuffled into a static, immutable array of 136 indices. Instead, the engine maintains a strict, finite inventory of unrevealed tiles (`remainingPool`) and dynamically samples draws on demand based on player-specific weight vectors.
2. **Hand Trajectory DAG (Directed Acyclic Graph):** The engine tracks player hands as paths toward high-value target archetypes (e.g., Tanyao speed, Chin'itsu flush, Ryuuiisou Yakuman). Superpowers guide players along these trajectories rather than conjuring arbitrary tiles out of thin air.
3. **Pacing & Phase Integrity:** Abilities respect the natural three-row cadence of Riichi Mahjong:
   - **Row 1 (Turns 1–6):** Early speed & scouting (Yuuki).
   - **Row 2 (Turns 7–12):** Mid-game efficiency, table reading, and standard Tenpai (Nodoka, Mako).
   - **Row 3 (Turns 13–18):** Deep-wall traps, Haitei miracles, and climactic finishers (Saki, Hisa, Koromo).
4. **Tile Conservation Law:** Every tile drawn or revealed originates strictly from the standard 136-tile pool. A tile cannot be drawn if its remaining count in the pool is zero ($\text{Weight} = 0$). Ghost tiles, 5th copies, and memory desyncs are mathematically impossible.
5. **Deterministic Replayability:** Given an initial random seed (e.g., PCG32/xoshiro256) and the sequence of player inputs, every dynamic draw and trajectory calculation is 100% deterministic and reproducible for anticheat verification and match replays.

---

## 2. Engine Data Structures & Mathematical Formalism

### 2.1 The Finite Tile Pool & Conservation Invariant
Let $\mathcal{T}$ be the set of 34 normalized tile kinds:
$$\mathcal{T} = \{1m \dots 9m, 1p \dots 9p, 1s \dots 9s, 1z \dots 7z\}$$
Including 3 Aka-Dora tiles (`0m`, `0p`, `0s`), the global tile count satisfies:
$$\sum_{t \in \mathcal{T}} \text{Count}(t) = 136$$

At any turn $\tau$, the engine state decomposes into:
$$\mathcal{S}_\tau = \langle \mathcal{H}_{0..3}, \mathcal{M}_{0..3}, \mathcal{R}_{0..3}, \mathcal{D}_{\text{wanpai}}, \mathcal{P}_{\text{live}}, \text{Flow}_{0..3} \rangle$$
Where:
- $\mathcal{H}_i$: Concealed hand of seat $i$ ($|\mathcal{H}_i| \in \{1, 4, 7, 10, 13, 14\}$).
- $\mathcal{M}_i$: Melded sets of seat $i$ (Chi, Pon, Kan).
- $\mathcal{R}_i$: Discard river of seat $i$.
- $\mathcal{D}_{\text{wanpai}}$: Dead wall multiset ($|\mathcal{D}_{\text{wanpai}}| = 14$).
- $\mathcal{P}_{\text{live}}$: Live unseen pool multiset ($|\mathcal{P}_{\text{live}}| = 136 - \sum |\mathcal{H}_i| - \sum |\mathcal{M}_i| - \sum |\mathcal{R}_i| - 14$).

### 2.2 The Dynamic Sampling Function
When seat $i$ draws at turn $\tau$:
$$P(\text{draw } t \mid \mathcal{S}_\tau, i) = \frac{\mathcal{P}_{\text{live}}[t] \cdot W(t, \mathcal{S}_\tau, i)}{\sum_{k \in \mathcal{T}} \mathcal{P}_{\text{live}}[k] \cdot W(k, \mathcal{S}_\tau, i)}$$

Where $W(t, \mathcal{S}_\tau, i) \ge 0$ is the dynamic weight multiplier computed by active character abilities:
- For a standard player or non-supernatural bot: $W(t) = 1.0$ (pure uniform random sampling identical to a physical shuffled deck).
- For a player with active affinities: $W(t)$ scales proportionally to trajectory relevance, Dora status, or wait satisfaction.
- **Hard Conservation Boundary:** If $\mathcal{P}_{\text{live}}[t] = 0$, then $P(\text{draw } t) = 0$ unconditionally.

---

## 3. The 4-Phase Game Lifecycle

Supernatural effects hook cleanly into the engine across four lifecycle phases without mutating underlying game rules:

```
+-----------------------------------------------------------------------+
| Phase 0: Pre-Deal Hand Shaping                                         |
| - Generates initial 13 tiles from the 136 pool                        |
| - Constrains Shanten within realistic bounds (average 2.8 - 3.4)       |
| - Injects structural seeds (e.g., pairs for Saki, Tanyao for Yuuki)   |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
| Phase 1: Wall & Slot Reservation                                      |
| - Allocates Wanpai (Dora indicators & Rinshan slots)                  |
| - Pins deep-wall anchors (e.g., Koromo's Haitei winning tile)          |
| - Sets historical layout seeds (Mako)                                 |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
| Phase 2: Dynamic Draw & Turn Pacing                                   |
| - Calculates Trajectory DAG for active player                         |
| - Evaluates W(t) multipliers on draw                                  |
| - Manages turn decision clocks (4s - 10s) and hesitation drains        |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
| Phase 3: Hand Settlement & Resolution                                  |
| - Validates Yaku, Han, Fu using standard Riichi scoring               |
| - Awards Flow Gauge based on defensive/offensive actions             |
| - Updates multi-hand states (Escalation streaks, Takami Granary)      |
+-----------------------------------------------------------------------+
```

---

## 4. The Hand Trajectory DAG & Intent Inference

A hand is modeled as an evolving graph of future winning targets. This system allows the engine to intelligently assist players and predict board states.

### 4.1 Trajectory Node Definition
Each trajectory node $\mathcal{N}$ contains:
- **Target Archetype:** e.g., `Tanyao_Pinfu`, `Honitsu_Manzu`, `Chinitsu_Souzu`, `Suuankou_Yakuman`, `Kokushi_Musou`.
- **Shanten Distance to Target ($d$):** Number of tile substitutions required to reach Tenpai under that archetype.
- **Bridge Tiles ($\mathcal{B}$):** Exact tile kinds from $\mathcal{P}_{\text{live}}$ that decrease $d$.
- **Expected Value (EV):** Base scoring potential multiplied by remaining bridge availability in $\mathcal{P}_{\text{live}}$.

### 4.2 Intent Inference
On every player discard:
$$\Delta d_{\text{archetype}} = d_{\text{before}} - d_{\text{after}}$$
The engine identifies which archetype the player prioritized. When a player actively commits to a path (e.g., discarding high-value Pinzu to retain an isolated Green Dragon `Hatsu`), the engine switches the active trajectory to `Ryuuiisou` / `Honitsu` and biases future bridge draws accordingly.

---

## 5. Universal Taxonomy of Character Abilities

To make the codebase modular, extensible, and clean, every character power in the *Saki* universe is implemented as a composition of **Six Primitive Ability Archetypes**:

```
                       +-------------------------------+
                       |  Superpower Engine Framework  |
                       +-------------------------------+
                                       |
    +---------------+------------------+------------------+---------------+
    |               |                  |                  |               |
    v               v                  v                  v               v
[1. Trajectory]  [2. Slot]       [3. Field]        [4. Perception]  [5. Tempo]
  Shapers          Reservers       Enforcers         Warpers          Economists
                                                                          |
                                                                          v
                                                                    [6. Settlement]
                                                                        Modifiers
```

### Archetype 1: Trajectory & Path Shapers
* **Definition:** Modifies the probability weights $W(t)$ during regular draw steps to steer the player's hand along specific branches of the Trajectory DAG.
* **Primitive API:** `applyTrajectoryWeight(tile, activeTrajectory, multiplier)`
* **Examples:**
  * *Yuu Matsumi:* Applies $W(t) \times 1.5$ for all Manzu tiles and Red Dragons.
  * *Kaori Senoo:* Applies $W(t) \times 3.0$ for terminal and honor tiles when on the `Kokushi_Musou` trajectory.
  * *Nodoka Haramura:* Applies $W(t) \propto \text{UkeireGain}(t)$ based on mathematical 5-block theory.
  * *Yuuki Kataoka:* Applies $W(t) \times 1.6$ for simple numbers (`2–8`) during East rounds.

### Archetype 2: Slot & Milestone Reservers
* **Definition:** Dynamically reserves a specific tile from the finite pool and binds it to a specialized temporal or spatial slot in the game state.
* **Primitive API:** `reserveSlot(targetTile, slotLocation, triggerCondition)`
* **Examples:**
  * *Saki Miyanaga (Rinshan Kaihou):* Binds the hand's winning wait or matching 4th triplet tile to the dead-wall replacement slot (`Wanpai[rinshan_idx]`).
  * *Koromo Amae (Haitei Anchor):* Binds Koromo’s winning wait to the final live wall slot (`liveWallCount == 1`). If an opponent calls Chi/Pon/Kan, the draw count decrements early, naturally displacing the anchor.
  * *Takami Shibuya (Autumn Granary):* Stores the tile kind discarded on Turn 1 into a persistent cross-hand array (`granary[]`) and reserves them for high draw priority during All-Last.
  * *Kuro Matsumi (Dragon Road):* Prioritizes active Dora indicators and binds matching Dora tiles to Kuro's draw weights.

### Archetype 3: Field & Aura Enforcers
* **Definition:** Modifies environmental table parameters, dampening opponent draw multipliers, suppressing supernatural meters, or elevating table risk.
* **Primitive API:** `applyFieldAura(auraType, targetSeats, intensity, durationTurns)`
* **Examples:**
  * *Shizuno Takakamo (Deep Mountain):* When live wall tiles $\le 30$, reduces all opponent supernatural draw-weight multipliers by $70\%$ ($W_{\text{opp}}(t) = 1.0 + (W_{\text{opp}}(t) - 1.0) \times 0.3$).
  * *Kyouko Suehara (Anti-Monster Field):* Suppresses all opponent supernatural draw-weight bonuses to $1.0$ (pure baseline Riichi) for 3 turns.
  * *Koromo Amae (Shanten Mire):* Reduces opponent draw weights for tiles that decrease their Shanten by $40\%$.
  * *Hisa Takei (Intimidation Aura):* Projects high-risk threat flags on opponent assist meters when declaring Riichi, draining opponent Flow Gauge.

### Archetype 4: Perception & Information Warpers
* **Definition:** Alters client-side HUD presentations (danger radars, river appearance, Shanten perception, wait overlays) without corrupting server-side truth or desynchronizing match state.
* **Primitive API:** `modifyClientHUD(targetSeat, visualEffect, telemetryData)`
* **Examples:**
  * *Toki Onjouji (Precognition / Chrono Vision):* Renders a ghost preview of her deterministic next draw and displays the primary trajectory danger vectors of opponents (anticipated waits).
  * *Mihoko Fukuji (Heaven’s Eye):* Opens her right eye at $\ge 50\%$ Flow, broadcasting exact opponent Shanten counts and highlighting high-risk discard candidates.
  * *Momoko Touyoko (Negative Presence):* Sends masked audio-visual packets to opponents (rendering discards semi-transparent and omitting Riichi audio alerts), while the server preserves full game integrity.
  * *Hajime Kunihiro (River Mirage):* Overlays aesthetic glamour on client river evaluation, scrambling danger-meter ratings while retaining exact tile IDs on the server.

### Archetype 5: Tempo & Cadence Economists
* **Definition:** Manipulates the turn clock, meld calling priority, decision windows, and pacing economics.
* **Primitive API:** `adjustTurnClock(targetSeat, durationSeconds, penaltyType)`
* **Examples:**
  * *Yuuki Kataoka (Taco Rush):* Reduces table-wide turn decision clocks to 6 seconds during East rounds to force fast, instinctive play.
  * *Ako Atarashi (Melodic Cadence):* Calling an open meld slashes the discarder's subsequent turn decision window by 2 seconds and drains their meter.
  * *Koromo Amae (Hesitation Drain):* Opponents who take longer than 5 seconds to discard lose $5\%$ Flow Gauge per second of hesitation.

### Archetype 6: Settlement & Scoring Modifiers
* **Definition:** Modifies the end-of-hand point settlement legitimately through authentic Riichi rule parameters (Dora indicators, Ura-Dora seeding, Han bonuses, damage mitigation) without breaking standard scoring calculators.
* **Primitive API:** `applySettlementModifier(resultObject, scoringContext)`
* **Examples:**
  * *Teru Miyanaga (Escalation Helix):* Tracks an unbroken streak counter across hands; guarantees progressive scoring tiers by guiding hands toward naturally higher Han/Fu configurations.
  * *Kuro Matsumi (Dragon Force):* Resolves unrevealed Ura-Dora indicators by matching tiles held in Kuro's closed hand, yielding legal authentic Sanbaiman / Kazoe Yakuman payouts.
  * *Kana Ikeda / Atago Sisters (Damage Mitigation):* Mitigates deal-in point costs by a percentage (e.g., $30\%–50\%$) when trailing in last place.

---

## 6. Flow Gauge Economy & Pacing Constraints

To prevent front-loaded imbalances, all supernatural interactions are governed by the **Flow Gauge Economy**:

```
+---------------+---------------+---------------+--------------------+
| Tier 1 (25%)  | Tier 2 (50%)  | Tier 3 (100%) | Tier 4 (150%)      |
| Tactical Read | Hand Steerer  | Signature Move| Climactic Overdrive|
+---------------+---------------+---------------+--------------------+
```

### 6.1 Meter Rules
1. **Initial State:** All players start Round 1 at **0% Flow Gauge**.
2. **Turn Generation:** Legal discards yield $+1.5\%$ Flow baseline.
3. **Thematic Accelerators:**
   * Saki: $+50\%$ bonus meter on successful defensive folds / paying small costs.
   * Nodoka: Double meter gain when playing mathematical max Uke-ire.
   * Yuuki: $+50\%$ meter gain in East; $-50\%$ penalty in South.
   * Mako: $0\%$ meter on Turns 1–6; ramps $+20\%$/turn from Turn 7 onwards.
   * Kana: $+60\%$ meter acceleration when in 4th place or under 15,000 pts.
4. **Meter Decay on Mishaps:** Dealing into an opponent's Riichi drains $20\%–30\%$ Flow Gauge.
5. **Overdrive Ceiling:** Reaching $150\%$ Flow requires accumulating meter across multiple hands, guaranteeing that game-ending super moves occur **at most 1–2 times per Hanchan**.

---

## 7. Implementation Roadmap & Architecture in Code

The following modular structure integrates directly into the existing repository:

```
engine/
├── game.js                  # Core Riichi game loop & state machine
├── scoring.js               # Wrapper around riichi / agari libraries
├── powers/
│   ├── index.js             # Power registry & lifecycle dispatcher
│   ├── flowManager.js       # Flow gauge accumulation, drain & limits
│   ├── trajectoryPlanner.js # DAG analyzer & bridge tile calculator
│   ├── dynamicPool.js       # Schrödinger's Wall weighted sampler
│   └── rosters/
│       ├── kiyosumi.js      # Saki, Nodoka, Yuuki, Mako, Hisa
│       ├── ryuumonbuchi.js  # Koromo, Touka, Momoko, Hajime
│       ├── achiga.js        # Kuro, Yuu, Shizuno, Ako
│       └── shiraitodai.js   # Teru, Sumire, Takami, Awai
```

### Core Execution Loop Integration
```javascript
// Inside game.js draw step:
function executeDrawStep(seat, state) {
  const player = state.players[seat];
  
  // 1. Calculate active trajectory & needed bridges
  const trajectory = TrajectoryPlanner.getActiveTrajectory(player.hand, state.pool);
  
  // 2. Compute dynamic weights for unseen tiles
  const weights = PowerDispatcher.computeDrawWeights(seat, state, trajectory);
  
  // 3. Sample dynamically from the finite pool (Schrödinger's Wall)
  const drawnTile = DynamicPool.sample(state.pool, weights, state.rng);
  
  // 4. Update hand & pool state
  player.hand.push(drawnTile);
  state.pool.decrement(drawnTile);
  
  // 5. Post-draw HUD and ability triggers
  PowerDispatcher.onPostDraw(seat, drawnTile, state);
}
```

---

## 8. Summary of Advantages

1. **Zero Rule Violations:** No Chombo, no 15-tile hands, no ghost tiles, and no arbitrary score hacks.
2. **Fluid Counterplay:** Opponents calling Chi/Pon/Kan naturally alters wall counts and timeline progression, mirroring the anime's core tactical interplay.
3. **Modular & Scalable:** Any new character from the 50+ *Saki* cast can be created by combining the 6 primitive archetypes without touching the core Riichi engine.
4. **Authentic Pacing:** Preserves the authentic tension, defense, and drama of competitive Riichi Mahjong.

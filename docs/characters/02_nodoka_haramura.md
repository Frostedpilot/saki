# Character Implementation Spec: Nodoka Haramura (原村 和)

## 1. Metadata & Core Archetype

* **School:** Kiyosumi High (Nagano)
* **Seat / Role:** Deputy / Ace (Fukushou)
* **Archetype:** Mid-Game Mathematical Consistency & Digital Sight (Trajectory Shaper + Perception Warper)
* **Primary Window:** Row 2 (Turns 7–11) — Optimal Uke-ire & EV Tenpai

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:** +1.5% per legal discard turn.
* **Thematic Accelerators:**
  * **Mathematical Perfection (Human Stance):** While Flow < 50%, whenever Nodoka discards the tile that yields the maximum possible *Uke-ire* (tile acceptance, verified by `syanten.hairi`), she gains **+3.5% Flow** instead of +1.5%.
  * **Nodocchi Mode (Flow $\ge 50\%$):** Generation stabilizes at +2.0% per turn.
* **Drain Conditions:**
  * Playing a sub-optimal discard with $>3$ tiles less acceptance than the optimum inflicts a -10% Flow penalty.

---

## 3. Thematic Passive: Etopen’s Anchor / Nodocchi Mode

### Mechanism
* **State 1: Human Stance (Flow < 50%):** Standard play; accelerated meter gain on optimal EV discards; suffers a -10% defense rating against Hell-waits and Suji traps.
* **State 2: Nodocchi Mode (Flow $\ge 50\%$):** Nodoka holds Etopen and transitions into online/digital mode:
  * **Absolute Sensor Immunity:** Nodoka bypasses 100% of information-distortion effects (Momoko’s stealth river, Hajime’s visual glamour, false Suji tells).
  * **Bot EV Gate:** If Nodoka is controlled by an AI bot, she strictly rejects open calls (Chi/Pon) on hands with expected point value under 2,000 points.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Statistical Filter (統計的濾過)
* **Trigger Point:** On draw step during Turns 1–8.
* **State Mutation:**
  * For her next 3 draws, sets weight $W(t) = 0.0$ for isolated terminal and honor tiles (`1m, 9m, 1p, 9p, 1s, 9s, 1z–7z`) that do not form pairs or triplets with her current hand.
  * Live wall sampling pool is compressed to suited middle tiles (`2–8`), increasing hand advancement rate by +35%.
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Optimal Discard Matrix (確率論的防壁)
* **Trigger Point:** On draw step when facing 1+ opponent in Riichi or Tenpai threat.
* **State Mutation:**
  1. Engine runs `getWaits` across all 3 opponents.
  2. Identifies the intersection of 100% safe tiles (*Genbutsu* / Furiten safe against all active threats).
  3. Highlights the optimal safe discard on Nodoka's HUD with a cyan digital reticle.
  4. If Nodoka holds no safe tiles, her current draw is dynamically sampled exclusively from the subset of `remainingPool` that are *Genbutsu* against the leading threat.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — Machine Shanten Compression (機械的向聴圧縮)
* **Trigger Point:** On draw step during Turns 5–10 when Shanten is 1 or 2.
* **State Mutation:**
  1. Engine evaluates the Trajectory DAG and calculates the optimal two **Bridge Tiles** ($\mathcal{B}_1, \mathcal{B}_2$) that reduce Shanten distance to 0 (Tenpai).
  2. For Nodoka's next 2 draws, sets $W(\mathcal{B}_1) = 15.0$ and $W(\mathcal{B}_2) = 15.0$.
  3. Guarantees that Nodoka enters closed Tenpai within 2 turns without breaking tile conservation.
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Absolute EV Singularity (特異点・完全計算)
* **Trigger Point:** In Tenpai (Turn 7+).
* **Execution (100% Rules Compliant):**
  1. Lasts for 3 consecutive turns.
  2. **Safe Draw Shielding:** On each of her 3 turns, her drawn tile is guaranteed to be a tile that carries **0% deal-in risk** against all opponents (drawn from the pool of common safe tiles).
  3. **Winning Wait Magnetism:** Her draw weight for her declared winning wait is multiplied by **$4.0\times$**.
  4. **Why this preserves rules:** Unlike the old design that attempted to make her discards immune to Ron (which breaks the game engine), this design guarantees that **she only draws safe tiles**, achieving 0% deal-in risk authentically and legally.
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class NodokaHaramuraHooks {
  // Phase 0: Pre-Deal Hand Shaping
  static onPreDeal(deck, nodokaSeat) {
    // Curates a clean 5-block starting hand (Shanten ~2.5 - 2.8)
    // 2 Ryanmen shapes, 1 honor pair, 2 floating middle tiles
    return shapeFiveBlockHand(deck, nodokaSeat);
  }

  // Phase 2: Dynamic Draw Weights
  static onPowerDraw(tile, nodokaHand, flowGauge, activeSkill, threats, livePool) {
    // Tier 1: Filter dead terminals/honors
    if (activeSkill === 'statistical_filter') {
      if (isDeadTerminalOrHonor(tile, nodokaHand)) return 0.0;
    }

    // Tier 3: Shanten Compression
    if (activeSkill === 'shanten_compression') {
      const bridges = TrajectoryPlanner.getOptimalBridges(nodokaHand, livePool);
      if (bridges.includes(norm(tile))) return 15.0;
    }

    // Standard Nodocchi Mode (Flow >= 50%): subtle Uke-ire boost
    if (flowGauge >= 50) {
      const ukeGain = calculateUkeireGain(nodokaHand, tile);
      return 1.0 + (ukeGain * 0.25);
    }

    return 1.0;
  }

  // Phase 3: Settlement
  static onSettlement(result, nodokaSeat, flowManager) {
    // Reset Overdrive upon win
    if (result.winner === nodokaSeat && result.tag.includes('EV_SINGULARITY')) {
      flowManager.consumeAll(nodokaSeat);
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `NODOCCHI_MODE_TOGGLE`: `{ active: boolean }` (Triggers pink digital matrix HUD and Nodocchi avatar transform).
* `DIGITAL_RETICLE_UPDATE`: `{ safeTiles: string[], optimalDiscard: string, ukeireCount: number }` (Draws cyan EV indicators over Nodoka's hand).
* `STEALTH_BYPASS_CONFIRMATION`: Broadcast to Nodoka when Momoko or Hajime's visual effects are suppressed by digital sight.

---

## 7. Deterministic Unit Test Scenarios

1. **Uke-ire Meter Gain Test:**
   * Discard max-Ukeire tile $\rightarrow$ Flow gains +3.5%.
   * Discard sub-optimal tile (-4 ukeire) $\rightarrow$ Flow gains standard +1.5% and triggers warning.
2. **Stealth Piercing Test:**
   * Seat Momoko with active stealth. Verify Nodoka’s client receives true tile identifiers and full opacity discards when Flow $\ge 50\%$.
3. **Safe Draw Overdrive Test:**
   * Put Seat 1 into Riichi waiting on `4m` and `7m`.
   * Trigger Nodoka Tier 4 Overdrive. Verify that over the next 3 draws, Nodoka never draws `4m` or `7m` if they would deal in.

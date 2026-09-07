# Character Implementation Spec: Saki Miyanaga (宮永 咲)

## 1. Metadata & Core Archetype

* **School:** Kiyosumi High (Nagano)
* **Seat / Role:** Captain / Anchor (Taishou)
* **Archetype:** Late-Game Climax & Counter-Puncher (Slot Reserver + Trajectory Shaper)
* **Primary Window:** Row 2–3 (Turns 9–18) & Kan / Rinshan resolutions

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:** +1.5% per legal discard turn.
* **Thematic Accelerators:**
  * **Defensive Guard (+50% bonus):** Earns +3.0% Flow instead of +1.5% whenever discarding a tile that is *Genbutsu* (100% safe) against an active opponent Riichi.
  * **Damage Absorption:** When paying out Ron or Tsumo damage under 4,000 points, gains +10% flat Flow.
* **Drain Conditions:**
  * Dealing into a Haneman+ Ron drains 25% Flow.

---

## 3. Thematic Passive: Platitude Equilibrium ($\pm 0$)

### Mechanism
Saki gains draw affinity toward closed triplets (*Koutsu*) only when her score delta is close to even.

### Logic & Math
```javascript
function evaluateEquilibrium(score, startScore = 25000) {
  const delta = Math.abs(score - startScore);
  return delta <= 1500; // Active within +/- 1500 points of start
}
```
* **When Active:** In `onPowerDraw`, any tile $t$ for which Saki already holds 2 copies in her concealed hand receives a weight multiplier:
  $$W(t) = W(t) \times 1.35$$
* **When Inactive:** If Saki takes a large lead ($>26,500$) or deep deficit ($<23,500$), this passive deactivates ($W(t) = 1.0$), forcing standard draw probabilities.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Ridge Glimmer (嶺上の微光)
* **Trigger Point:** On declaring any Kan (Closed, Daiminkan, or Kakan).
* **Precondition:** Live pool contains at least 1 Rinshan tile.
* **State Mutation:**
  1. Inspect `remainingPool`.
  2. Compute Saki's waits via `getWaits(sakiHand)`.
  3. If Saki is in Tenpai and $\exists w \in \text{waits}$ with $\mathcal{P}_{\text{live}}[w] > 0$:
     * Assign $W_{\text{rinshan}}(w) = 10.0$ (delivering ~45% net Rinshan win chance).
  4. If not in Tenpai or wait unavailable:
     * Assign $W_{\text{rinshan}}(t) = 3.0$ for all tiles $t$ that improve or maintain Shanten (*Uke-ire* preservation).
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Twin Ridges (双嶺開花)
* **Trigger Point:** On declaring Kan #1.
* **Preconditions:** Saki holds at least 1 other closed triplet in hand ($|\text{triplets}| \ge 2$).
* **State Mutation:**
  1. Identify triplet #2 in hand (e.g., three `7p`).
  2. Reserve the 4th `7p` from `remainingPool` (if $\mathcal{P}_{\text{live}}[\text{'7p'}] \ge 1$) and place it into Rinshan Slot 1 (`dead[0]`).
  3. Upon drawing `dead[0]`, Saki declares Kan #2 immediately.
  4. On Rinshan Slot 2 (`dead[1]`), boost the weight of her winning wait by $5.0\times$ (+50% Rinshan win rate).
* **Fallback:** If the 4th matching tile is exhausted in opponent hands/discards, falls back to Tier 1 behavior with a 20% Flow refund.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — Triple Summit / San Kantsu (三槓の頂)
* **Trigger Point:** On declaring Kan #1.
* **Preconditions:** Saki holds at least 2 closed triplets and 1 pair ($|\text{triplets}| \ge 2, |\text{pairs}| \ge 1$).
* **State Mutation:**
  1. Chains Kans #1, #2, and #3 sequentially through Rinshan slots.
  2. **Kan Dora Seeding:** For each Kan Dora revealed (`dead[4 + kanCount*2]`), the indicator tile is swapped from unseen pool tiles so its subsequent Dora points directly to a tile already held in Saki's hand.
  3. 3rd Rinshan replacement draw receives an **80% deterministic win weight** for her winning wait.
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Suukantsu Bounded Climax (四槓子・嶺上極地)
* **Trigger Point:** On declaring Kan #1 when Saki holds 3 closed triplets ($|\text{triplets}| \ge 3$).
* **Execution & Invariant Protection:**
  1. Saki executes up to 4 consecutive Kans.
  2. To maintain 14-tile Wanpai integrity and avoid Suukaikan abort (solo quad continues in engine rules):
     * The engine checks if the final winning wait $w$ exists in `remainingPool`:
       * **Branch A (Win Exists):** Map $w$ deterministically into Rinshan slot #4 (`dead[3]`). Saki draws $w$, achieving a legal **Suukantsu + Rinshan Kaihou Double Yakuman** (64,000 pts / 96,000 pts Oya).
       * **Branch B (Win Exhausted):** If all copies of $w$ are visible in rivers/melds, the sequence terminates safely at Kan #3. Saki draws an alternative sequence-completer for a guaranteed **San Kantsu + Rinshan Kaihou Baiman (8 Han)** win, preventing dead-wall exhaustion.
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class SakiMiyanagaHooks {
  // Phase 0: Pre-Deal Hand Shaping
  static onPreDeal(deck, sakiSeat, flowGauge) {
    if (flowGauge >= 100) {
      // Seed potential: ensure Saki is dealt at least 2 closed triplets and 1 pair
      // Shanten is kept within ~2.5 - 3.0 (normal bounds)
      return shapeSakiStartingHand(deck, sakiSeat);
    }
  }

  // Phase 1: Wall & Slot Reservation
  static onWallSetup(livePool, deadWall, sakiSeat, activeSkill) {
    if (activeSkill === 'twin_ridges' || activeSkill === 'san_kantsu') {
      // Pre-slot Rinshan replacement tiles into deadWall[0..3]
      slotRinshanTiles(livePool, deadWall, sakiSeat);
    }
  }

  // Phase 2: Dynamic Draw Weights
  static onPowerDraw(tile, sakiHand, score, livePool) {
    if (evaluateEquilibrium(score)) {
      // 1.35x multiplier on tiles completing triplets
      const countInHand = sakiHand.filter(t => norm(t) === norm(tile)).length;
      if (countInHand === 2) return 1.35;
    }
    return 1.0;
  }

  // Phase 3: Settlement
  static onSettlement(result, sakiSeat, flowManager) {
    if (result.type === 'tsumo' && result.winner === sakiSeat && result.tag.includes('RINSHAN')) {
      flowManager.consumeAll(sakiSeat);
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `SAKI_EQUILIBRIUM_STATE`: `{ active: boolean, delta: number }` (Toggles a subtle floral aura around Saki's avatar).
* `RINSHAN_RESONANCE_TRIGGER`: `{ tier: number, kanCount: number }` (Plays dead-wall particle effects along the Wanpai on client screen).
* `KAN_DORA_REVEAL`: Standard Riichi Dora event broadcast; no client desync.

---

## 7. Deterministic Unit Test Scenarios

1. **Equilibrium Boundary Test:**
   * Hand at 25,000 pts $\rightarrow$ Triplet draw multiplier is 1.35.
   * Hand at 27,000 pts $\rightarrow$ Triplet draw multiplier is 1.0.
2. **Wanpai Conservation Test:**
   * Execute Tier 4 Suukantsu: Verify that dead wall never drops below 14 tiles and no 5th copy of any tile exists across hands, discards, and dead wall.
3. **Exhaustion Fallback Test:**
   * Exhaust all 4 copies of Saki's winning wait in opponent discards. Trigger Tier 4.
   * Verify engine cleanly falls back to San Kantsu Baiman at Kan 3 without throwing exceptions.

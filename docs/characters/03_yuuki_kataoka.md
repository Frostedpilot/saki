# Character Implementation Spec: Yuuki Kataoka (片岡 優希)

## 1. Metadata & Core Archetype

* **School:** Kiyosumi High (Nagano)
* **Seat / Role:** Vanguard (Senpou)
* **Archetype:** Early Blitz & Turn Pressure Specialist (Tempo Economist + Trajectory Shaper)
* **Primary Window:** Row 1 (Turns 1–6) strictly during **East Rounds (Ton)**

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:**
  * **East Rounds (Ton):** **+3.0%** per legal discard turn (+100% boost).
  * **South Rounds (Nan - Sugar Crash):** **+0.75%** per legal discard turn (-50% penalty).
* **Thematic Accelerators:**
  * Calling an open meld (Chi/Pon) on turns 1–5 awards +10% flat Flow.
  * Winning as Dealer (Oya) in East grants +25% Flow.
* **Drain Conditions:**
  * Dealing in during South round increases score payout by +15% and drains 25% Flow.

---

## 3. Thematic Passive: Fast-Twitch Metabolism (Taco Rush / Sugar Crash)

### Mechanism
* **East Rounds (Ton):**
  * **Turn Clock Pressure:** Reduces decision timers for all 4 players at the table to **6 seconds** (brisk, aggressive tournament tempo).
  * **Speed Tile Affinity:** All simple numbers (`2–8`) and East Wind tiles (`1z`) receive a $+30\%$ draw-weight bias ($W(t) \times 1.30$).
* **South Rounds (Nan - Sugar Crash):**
  * Meter generation cut by half.
  * Points paid on opponent Ron or Tsumo wins increased by **+15%**.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Quick Bite (タコスひとくち)
* **Trigger Point:** On draw step during Turns 1–5.
* **State Mutation:**
  * Examines Yuuki's hand and identifies sequences missing a single connecting tile (e.g., holding `2-3m` or `6-8p`).
  * Biases the current draw from `remainingPool` toward the missing connector tile ($W(t) = 8.0$), instantly closing the block.
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Spicy Southward Defense (辛口タコス防衛)
* **Trigger Point:** In South round (Nan) when under pressure.
* **State Mutation:**
  1. Cleanses the "Sugar Crash" debuff for the remainder of the current hand (restoring meter gain and removing the +15% damage vulnerability).
  2. For her next 2 draws, filters out dangerous tiles matching opponent Riichi waits.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — East Wind Onslaught (東風怒涛・連荘)
* **Trigger Point:** Only usable while **Dealer (Oya) in East Round**.
* **State Mutation:**
  1. Multiplies the draw weight of East Wind honor tiles (`1z`) and active Dora tiles by **$3.0\times$**.
  2. **Dora Indicator Alignment:** If Yuuki completes her hand, the active Dora indicator is swapped with an unseen tile from the dead wall that matches her hand, awarding a legal **+2 Han bonus via legitimate Dora**.
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Ultimate Fiesta / Row-1 Blitz (タコス乱舞・速攻)
* **Trigger Point:** Turn 1 of any East Round hand.
* **Execution (100% Rules Compliant - No Mind Control):**
  1. **Turn-4 Tenpai Guarantee:** The server guides Yuuki's first 3 draws along a pure Tanyao or Yakuhai trajectory, guaranteeing that she enters Tenpai by **Turn 4**.
  2. **Blitzkrieg Pressure:** For Turns 4–7, her Tsumo draw weight for her winning tile is boosted to **75%**.
  3. **Why this eliminates the old "75% forced opponent deal-in":** Opponents are forced to discard dangerous middle tiles naturally because they haven't had time to build safe tiles or fold. Player agency is 100% preserved, while Yuuki’s terrifying first-row speed is fully realized.
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class YuukiKataokaHooks {
  // Phase 0: Pre-Deal Hand Shaping
  static onPreDeal(deck, yuukiSeat, kyokuState, flowGauge) {
    if (kyokuState.bakaze === 1) { // East Round
      // Shape hand with high proportion of simples (2-8) and East Wind (1z)
      // Shanten starts at ~2.0 - 2.5 (fast speed setup)
      return shapeYuukiEastHand(deck, yuukiSeat);
    }
  }

  // Phase 2: Dynamic Draw Weights & Turn Clock
  static onPowerDraw(tile, yuukiHand, kyokuState, activeSkill, livePool) {
    if (kyokuState.bakaze === 1) {
      // East Round: Taco Rush affinity
      if (isSimple(tile) || norm(tile) === '1z') return 1.30;
    }

    if (activeSkill === 'east_wind_onslaught') {
      if (norm(tile) === '1z' || isDora(tile)) return 3.0;
    }

    return 1.0;
  }

  // Phase 2 (Turn Clock Hook)
  static getTurnClock(kyokuState) {
    // East round cuts turn clock to 6 seconds
    return kyokuState.bakaze === 1 ? 6 : 10;
  }

  // Phase 3: Settlement
  static onSettlement(result, yuukiSeat, kyokuState) {
    // South round Sugar Crash damage penalty (+15% payout)
    if (kyokuState.bakaze === 2 && result.type === 'ron' && result.from === yuukiSeat) {
      result.scoresDelta *= 1.15;
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `TACO_RUSH_TIMER_SET`: `{ durationSeconds: 6, roundWind: 'E' }` (Fast-tempo sound effect and blazing clock UI).
* `SUGAR_CRASH_ALERT`: `{ active: boolean, penalty: 0.15 }` (Dimmed HUD and sleep emoji in South round).
* `TACO_POWER_BURST`: `{ tier: number }` (Spicy taco explosion animation upon skill activation).

---

## 7. Deterministic Unit Test Scenarios

1. **East vs South Meter Pacing Test:**
   * Run 10 turns in East $\rightarrow$ Verify Flow gains +30%.
   * Run 10 turns in South $\rightarrow$ Verify Flow gains +7.5%.
2. **Turn-4 Tenpai Blitz Test:**
   * Activate Tier 4 in East 1. Verify that by Turn 4, `shantenOf(yuukiHand) === 0`.
3. **Turn Clock Enforcement Test:**
   * In East round, verify engine sets turn timer to 6000ms. In South round, verify standard 10000ms.

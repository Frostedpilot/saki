# Character Implementation Spec: Koromo Amae (天江 衣)

## 1. Metadata & Core Archetype

* **School:** Ryuumonbuchi High (Nagano)
* **Seat / Role:** Captain / Anchor (Taishou)
* **Archetype:** Deep-Wall Monster & Haitei Executioner (Slot Reserver + Field Enforcer)
* **Primary Window:** Row 3 strictly (Turns 13–18 / Last 15 tiles of the wall)

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:** +1.5% per legal discard turn.
* **Thematic Accelerators:**
  * **Full Moon Phase (Hands 3–4 or Dealer Streaks):** Base meter generation accelerates by **+50%** (+2.25%/turn).
  * Entering Tenpai in the late wall ($\le 20$ tiles remaining) grants +25% flat Flow.
* **Drain Conditions:**
  * **Lonely Child Syndrome:** If an opponent scores a Haneman+ win off Koromo's direct discard, the lunar phase resets to "New Moon" for 2 hands (disabling passive bonus gain).

---

## 3. Thematic Passive: Lunar Phase Resonance (月詠)

### Mechanism (The Lunar Clock)
* **Crescent Phase (Hands 1–2):** Flow generation reduced by -25%. Koromo plays dormant.
* **Full Moon Phase (Hands 3–4 or Dealer Streaks):**
  * Flow generation spikes by +50%.
  * At $\ge 50\%$ Flow, reveals when opponents enter 1-Shanten or Tenpai via subtle lunar auras pulsing on the table HUD.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Chilling Gaze / Hesitation Drain (冷眼の重圧)
* **Trigger Point:** On opponent draw steps during Row 2–3 (Turns 7–15).
* **Execution (Redesigned - No Unplayable 2s Timer):**
  * *Why this replaces the 2s timer:* Over network play, 2 seconds causes accidental auto-tsumogiri.
  * *The Clean Implementation:* For 3 turns, opponents who take longer than **5 seconds** to discard lose **5% Flow Gauge** per second of hesitation, siphoning their meter into Koromo's pool.
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Oceanic Shanten Mire (深海の泥濘)
* **Trigger Point:** On draw step during Turns 8–14.
* **State Mutation:**
  * For 4 turns across the table, all 3 opponents suffer a **-40% draw-weight penalty** ($W_{\text{opp}}(t) \times 0.60$) for any tile that would decrease their Shanten count.
  * Freezes opponent hand progression, allowing the game to survive into the deep wall.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — Haitei Gravity (満月の引力)
* **Trigger Point:** When live wall drops to 20 tiles or fewer.
* **State Mutation:**
  1. Koromo's hand-advancing draw weight multiplies by **$2.5\times$**.
  2. **Haitei Win Alignment:** When live wall reaches the final tile, Koromo's draw probability for her winning wait is boosted to **75%**.
  3. **Payout Softening:** Opponents outside closed Riichi have their Ron payout capped at Mangan (softening counter-punches).
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Submerged Abyss / Haitei Raoyue (海底摸月・深海覚醒)
* **Trigger Point:** In Tenpai when live wall has $\le 14$ tiles remaining.
* **Execution (Authentic Anime Counterplay):**
  1. **Shanten Freeze:** Opponents suffer an **-80% draw-weight penalty** for Tenpai-completing tiles, effectively locking the board.
  2. **The Haitei Anchor:** Koromo's winning wait $w$ is reserved and pinned as the **very last tile of the live wall**.
  3. On her final draw before exhaustion, Koromo draws $w$, scoring an unavoidable **Haitei Raoyue Yakuman / Baiman Tsumo**.
  4. **The Counterplay Engine:** Every open meld call (Chi, Pon, or Kan) declared by an opponent consumes 1 live wall tile, shifting the turn sequence. Each meld called reduces Koromo's Overdrive win rate by **-25% per call** (at 3 calls, the Haitei tile is completely stolen by an opponent!).
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class KoromoAmaeHooks {
  // Phase 1: Wall Setup & Haitei Slot Reservation
  static onWallSetup(livePool, deadWall, activeSkill, koromoWait) {
    if (activeSkill === 'submerged_abyss' && koromoWait) {
      // Pin the winning wait at the tail of the live wall
      DynamicPool.reserveSlot(livePool, koromoWait, 'LAST_LIVE_TILE');
    }
  }

  // Phase 2: Dynamic Draw Weights
  static onPowerDraw(tile, playerSeat, koromoSeat, activeSkill, liveWallLeft) {
    // Oceanic Shanten Mire: freeze opponent hands
    if (activeSkill === 'shanten_mire' && playerSeat !== koromoSeat) {
      const improves = checkShantenImprovement(playerSeat, tile);
      if (improves) return 0.60;
    }

    // Submerged Abyss: freeze opponents late-game
    if (activeSkill === 'submerged_abyss' && playerSeat !== koromoSeat) {
      const completesTenpai = checkTenpaiCompletion(playerSeat, tile);
      if (completesTenpai) return 0.20; // -80% penalty
    }

    // Haitei Gravity on Koromo
    if (playerSeat === koromoSeat && liveWallLeft === 1) {
      return 25.0; // Overwhelming weight for final tile win
    }

    return 1.0;
  }

  // Phase 2: Open Meld Counterplay Hook
  static onOpponentMeld(koromoSeat, activeSkill) {
    if (activeSkill === 'submerged_abyss') {
      // Chi/Pon desynchronizes the Haitei anchor (-25% win rate per call)
      activeSkill.counterplayDampener += 0.25;
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `LUNAR_PHASE_CHANGE`: `{ phase: 'CRESCENT' | 'FULL_MOON' | 'NEW_MOON' }` (Renders moon visual in top-right of client screen).
* `OCEANIC_MIRE_ACTIVE`: `{ turnsRemaining: number }` (Water ripple overlay across opponent discard ponds).
* `HAITEI_GRAVITY_PULSE`: (Dramatic heartbeat audio cue when wall drops under 14 tiles).

---

## 7. Deterministic Unit Test Scenarios

1. **Lunar Phase Meter Scaling Test:**
   * Hand 1 (Crescent) $\rightarrow$ Verify Flow gain is +1.125%/turn (-25%).
   * Hand 3 (Full Moon) $\rightarrow$ Verify Flow gain is +2.25%/turn (+50%).
2. **Haitei Anchor & Melds Counterplay Test:**
   * Activate Tier 4 with 10 tiles left.
   * Case A (0 opponent calls) $\rightarrow$ Koromo draws winning tile on final turn (Haitei Raoyue win).
   * Case B (3 opponent calls) $\rightarrow$ Wall draw order shifts; Koromo does not receive the final tile.
3. **Opponent Shanten Suppression Test:**
   * Activate Tier 2. Verify opponent draw weight for hand-advancing tiles is strictly multiplied by 0.60.

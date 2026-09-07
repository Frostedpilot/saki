# Character Implementation Spec: Mako Someya (染谷 まこ)

## 1. Metadata & Core Archetype

* **School:** Kiyosumi High (Nagano)
* **Seat / Role:** Center (Chuuhou)
* **Archetype:** Mid/Late Table Reader & Historical Flow Rerouter (Perception Warper + Trajectory Shaper)
* **Primary Window:** Row 2 (Starts at **Turn 7+**) — Historical Pond Matching

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:**
  * **Turns 1–6:** **0%** Flow generation (dormant observation phase).
  * **Turn 7 onwards:** **+2.5%** Flow per turn, ramping by +0.5% each subsequent turn (+3.0% on turn 8, +3.5% on turn 9, etc.).
* **Thematic Accelerators:**
  * Accurately discarding a tile that is safe against an opponent who has made 2+ open melds awards +15% Flow.
* **Drain Conditions:**
  * Dealing into a closed Riichi with glasses removed drains 20% Flow.

---

## 3. Thematic Passive: The Parlor Archive (雀荘の記憶)

### Mechanism
* **Delayed Ignition:** Mako plays completely standard Mahjong during the early game. Her memory banks only activate once the river develops (Turn 7+).
* **Spectacle Removal (Active State Toggle):**
  * Removing her glasses activates deep memory matching:
    * **Penalty:** -10% defense resistance against closed Riichi hands.
    * **Bonus:** +35% tile-reading accuracy against any opponent who has made open melds (Chi/Pon/Kan), displaying their likely waiting shapes directly on Mako's client HUD.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Match Recognition (盤面照合)
* **Trigger Point:** On discard step from Turn 7 onwards.
* **State Mutation:**
  * Cross-references all 4 discard rivers with historical parlor game archives.
  * Identifies and marks the top 3 safest tiles in Mako's hand on her client HUD with gold borders for 3 turns.
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Flow Reroute (気流転換)
* **Trigger Point:** On draw step during Turns 7–12.
* **State Mutation:**
  * Restructures the upcoming live wall pool so Mako draws tiles that mimic a historical winning parlor layout.
  * Increases her hand advancement rate (*Uke-ire*) by **+40%** over her next 3 draws.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — River Mirroring / Tempo Choke (逆流の河)
* **Trigger Point:** Targeted at one specific opponent (typically the table leader).
* **State Mutation:**
  1. Identifies the targeted opponent's primary trajectory and current bridge tiles.
  2. For the next 4 turns, Mako draws the exact tiles that the targeted opponent needs to advance their hand.
  3. This completely chokes the opponent's draw progression while providing Mako with safe, non-deal-in holding tiles.
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Omnipresent Parlor Recall (全方位記憶覚醒)
* **Trigger Point:** In Tenpai during Row 2 or 3 (Turns 8–16).
* **State Mutation:**
  1. **Omniscient Radar:** Annotates every hidden wait across all three opponents on Mako's HUD with 100% accuracy for the remainder of the hand.
  2. **Historical Dora Alignment:** When Mako wins, the engine aligns the dead-wall Ura-Dora indicators to match her hand, awarding an authentic, rules-legal **+1 Han / +20 Fu execution bonus**.
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class MakoSomeyaHooks {
  // Phase 1: Wall Setup
  static onWallSetup(livePool, deadWall, kyokuState) {
    // Inject parlor pattern distribution: cluster honors and terminals in ripples
    applyHistoricalParlorClustering(livePool);
  }

  // Phase 2: Dynamic Draw Weights
  static onPowerDraw(tile, makoHand, turnCount, activeSkill, targetOpponentHand, livePool) {
    // Delayed Ignition: standard play turns 1-6
    if (turnCount < 7) return 1.0;

    // Tier 2: Flow Reroute (+40% Ukeire)
    if (activeSkill === 'flow_reroute') {
      const ukeGain = calculateUkeireGain(makoHand, tile);
      return 1.0 + (ukeGain * 0.40);
    }

    // Tier 3: River Mirroring (Choke opponent bridge tiles)
    if (activeSkill === 'river_mirroring' && targetOpponentHand) {
      const enemyBridges = TrajectoryPlanner.getOptimalBridges(targetOpponentHand, livePool);
      if (enemyBridges.includes(norm(tile))) return 5.0; // Mako snatches the tile
    }

    return 1.0;
  }

  // Phase 2 (Turn Meter Hook)
  static onTurnEnd(seat, turnCount, flowManager) {
    if (turnCount >= 7) {
      const ramp = 2.5 + (turnCount - 7) * 0.5;
      flowManager.addFlow(seat, ramp);
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `GLASSES_TOGGLE_STATE`: `{ removed: boolean }` (Triggers sound of glasses sliding off and activates amber sepia archival filter on screen).
* `HISTORICAL_MATCH_FOUND`: `{ layoutId: string, safeTiles: string[] }` (Renders gold safe-tile highlights).
* `OPPONENT_WAIT_REVEAL`: `{ waitsBySeat: Record<number, string[]> }` (Displays red warning markers over opponent seats).

---

## 7. Deterministic Unit Test Scenarios

1. **Delayed Meter Ignition Test:**
   * Run Turns 1–6 $\rightarrow$ Verify Flow remains at 0%.
   * Run Turn 7 $\rightarrow$ Verify Flow gains +2.5%.
   * Run Turn 8 $\rightarrow$ Verify Flow gains +3.0%.
2. **Tempo Choke Test:**
   * Seat 2 is in 1-shanten waiting for `3s`.
   * Activate Mako Tier 3 targeted at Seat 2.
   * Verify Mako draws `3s` before Seat 2 can draw it.
3. **Omnipresent Radar Accuracy Test:**
   * Place Seat 1 and Seat 3 in Tenpai.
   * Activate Mako Tier 4. Verify telemetry output matches exact waits from `getWaits`.

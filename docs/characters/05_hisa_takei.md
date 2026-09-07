# Character Implementation Spec: Hisa Takei (竹井 久)

## 1. Metadata & Core Archetype

* **School:** Kiyosumi High (Nagano)
* **Seat / Role:** Club President / Middle (Chuuhou)
* **Archetype:** Bad-Wait Gambler & Table Intimidator (Trajectory Shaper + Field Enforcer)
* **Primary Window:** Row 2–3 (Turns 9–16) — Hell-Waits (*Jigoku-machi*)

---

## 2. Flow Gauge Economy

* **Starting Flow:** 0%
* **Max Capacity:** 150%
* **Base Generation:** +1.5% per legal discard turn.
* **Thematic Accelerators:**
  * Shifting into an ugly wait (Tanki, Kanchan, Penchan) awards +15% flat Flow.
  * Declaring Riichi on a Hell-wait with only 1 tile remaining in the world awards +30% Flow.
* **Drain Conditions:**
  * Dealing in while in Riichi increases score payout by +25% and drains 25% Flow.

---

## 3. Thematic Passive: The Gambler’s Bravado (悪待ちの矜持)

### Mechanism (The "Bad Wait" Paradox)
* **Multi-sided sequence waits (Ryanmen, 5–8 winning tiles live):**
  * Suffers a **-30% draw-weight penalty** ($W(t) \times 0.70$). Hisa gets bored by standard textbook waits.
* **Ugly / Hell waits (Tanki pair wait, middle Kanchan, edge Penchan, or Jigoku-machi with $\le 2$ tiles live):**
  * Receives an iconic **$3.0\times$ winning draw multiplier** ($W(t) \times 3.0$).
* **Showmanship Slam:** When Hisa declares Riichi, all 3 opponents lose **10% Flow Gauge** from psychological intimidation.

---

## 4. Active Skills Specification

### Tier 1 (25% Flow) — Phantom Intimidation (悪霊の威嚇)
* **Trigger Point:** In 1-Shanten during Row 2 (Turns 7–12).
* **Execution (Redesigned - 100% Rules Compliant):**
  * *Why this replaces the old 1-Shanten Bluff Riichi:* In real Riichi, declaring Riichi without Tenpai results in Chombo and locks the player into Tsumogiri.
  * *The Clean Implementation:* Hisa projects a terrifying **Riichi-level threat aura** across the table without formally declaring Riichi:
    * Opponent assist meters and danger indicators evaluate Hisa as being in Riichi Tenpai.
    * Opponent bots bias heavily toward defensive folding for 3 turns.
    * Hisa remains completely free to advance her hand into Tenpai legally.
* **Cost:** Consumes 25% Flow.

---

### Tier 2 (50% Flow) — Jigoku Trap Forge (地獄待ちの鋳造)
* **Trigger Point:** When entering Tenpai on a 1-tile remaining wait ($w$).
* **State Mutation:**
  1. Locates the single remaining copy of $w$ in `remainingPool`.
  2. Injects $w$ into the upcoming draw sequence of an opponent who is currently folding or playing defensively.
  3. Because $w$ is typically an isolated terminal or honor tile that has sat uncalled all game, the opponent evaluates it as a safe discard and deals directly into Hisa's Ron wait.
* **Cost:** Consumes 50% Flow.

---

### Tier 3 (100% Flow) — Chaos Slap Tsumo (卓上強打・自摸)
* **Trigger Point:** In Tenpai on a 1-tile or 2-tile ugly wait.
* **State Mutation:**
  * For 3 turns, her draw weight for that specific remaining tile jumps to **70%**.
  * When she wins via Tsumo, she drains **25% Flow Gauge** from all 3 opponents.
* **Cost:** Consumes 100% Flow.

---

### Tier 4 (150% Overdrive) — Absolute Hell Dominance (冥府の絶対支配)
* **Trigger Point:** When live wall drops below 25 tiles while Hisa is in Hell-wait Tenpai.
* **Execution (100% Rules Compliant):**
  1. **Haitei Gravitation:** Her draw probability for her 1-tile wait on the final turns is set to **85%**.
  2. **Deal-in Damage Mitigation:** If Hisa deals into an opponent during this window, her payout damage is **dampened by 50%** (replacing the old flat 1,000 pt cap).
  3. **Temporary Furiten Pressure:** Opponents who hold Hisa's winning tile have their turn decision window slashed to 4 seconds, pressuring misplays.
* **Cost:** Consumes 150% Flow.

---

## 5. Lifecycle Hooks Implementation

```javascript
class HisaTakeiHooks {
  // Phase 0: Pre-Deal Hand Shaping
  static onPreDeal(deck, hisaSeat) {
    // Curate an awkward, fragmented starting hand (Kanchan 3-5, Penchan 8-9, isolated honors)
    return shapeHisaAwkwardHand(deck, hisaSeat);
  }

  // Phase 2: Dynamic Draw Weights
  static onPowerDraw(tile, hisaHand, hisaTenpai, activeSkill, livePool) {
    if (hisaTenpai) {
      const waits = getWaits({ hand: hisaHand, melds: [] });
      const isWait = waits.includes(norm(tile));
      
      if (isWait) {
        // Multi-sided wait penalty
        if (waits.length >= 2) return 0.70;
        
        // Single-tile Hell-wait bonus
        if (waits.length === 1) {
          if (activeSkill === 'chaos_slap') return 12.0; // ~70% win chance
          return 3.0; // Passive Gambler's Bravado
        }
      }
    }

    return 1.0;
  }

  // Phase 2 (Riichi Hook)
  static onDeclareRiichi(hisaSeat, players, flowManager) {
    // Showmanship Slam: drain 10% flow from all opponents
    for (const p of players) {
      if (p.id !== hisaSeat) flowManager.drainFlow(p.id, 10);
    }
  }

  // Phase 3: Settlement
  static onSettlement(result, hisaSeat, activeSkill) {
    // Tier 4 Damage Mitigation: 50% reduction on deal-ins
    if (activeSkill === 'hell_dominance' && result.type === 'ron' && result.from === hisaSeat) {
      result.scoresDelta *= 0.50;
    }
  }
}
```

---

## 6. Client-Server Protocol & HUD Events

* `PHANTOM_AURA_BROADCAST`: `{ seat: number, threatRating: 'EXTREME' }` (Plays table slam audio and surrounds Hisa in dark purple flames).
* `FLOW_INTIMIDATION_DRAIN`: `{ drainedAmount: 10 }` (Shows meter-loss particles floating from opponents to Hisa).
* `CHAOS_SLAP_TSUMO`: (Loud tile slam sound effect and screen shake upon Tsumo declaration).

---

## 7. Deterministic Unit Test Scenarios

1. **Wait Multiplier Test:**
   * Hand in Ryanmen wait (`2-sided`) $\rightarrow$ Verify draw multiplier is 0.70.
   * Hand in Hell-wait (`1-tile left`) $\rightarrow$ Verify draw multiplier is 3.0.
2. **Showmanship Flow Drain Test:**
   * Declare Riichi with Hisa. Verify all 3 opponent Flow gauges decrement by 10%.
3. **Damage Mitigation Test:**
   * Activate Tier 4. Force a deal-in into a Dealer Baiman (24,000 pts).
   * Verify Hisa pays only 12,000 pts (-50% reduction).

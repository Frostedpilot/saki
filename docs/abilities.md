# Saki PvP Mahjong: Complete Character Abilities & Ruleset

## Power Types: Flow Economy vs Normal Passive

Every roster power carries a `meta.type`, and both types coexist on the same table.

- **Flow (default):** The classic economy. Gauge charges 0–150, characters arm Tiers 1–4 and spend gauge to activate tradecraft (draw bias, wall manipulation, dead-wall reroutes). Example: Saki (Ridge Resonance), Koromo, Hisa.
- **Normal:** Always-on passives that live *outside* the Flow economy. The seat's gauge is pinned at `0`, no tiers can be armed or activated, and the power never drains or banks. It is either active (full strength) or, for special cases like normal-type Saki, disabled for the remainder of the hand by a triggering event. Example: Yuu Matsumi (Thermal Affinity), Saki's normal-type variant (Ridge Bias).
- The engine routes every hook by type: `powerTypeOf(seat)` reads the roster `meta.type`; normal seats are no-ops against every FlowManager mutation and are ignored by tier-arm commands.
- The client renders normal-type powers as a **PASSIVE pill** (dashed border, no meter, no Tier console) driven by `evSuperpowerIndicator` events carrying `type: 'normal'` and `gauge: null`.

## High School Rosters & Core Superpower Overview

### Kiyosumi High

- **Saki Miyanaga**: score equilibrium + Rinshan Kaihou (wins off dead wall after kan; replacement tile affinity; dead-wall Dora control; bounded 4-Kan climax). *Normal-type variant `saki-normal`: Ridge Bias — always-on 4th-copy kan magnetism, 100% Rinshan at tenpai, disabled by any opponent kan.*
- **Nodoka Haramura**: Digital / Nodocchi mode (online-speed efficiency, mathematical board sight, absolute immunity to stealth/distortion debuffs).
- **Yuuki Kataoka**: East-round blitz specialist (dominant early leads in Ton, sugar crash in Nan, fast-hand acceleration).
- **Mako Someya**: Parlor memory archive (removes glasses to cross-reference table flow against historical parlor records).
- **Hisa Takei**: Bad-wait intimidation (jigoku-machi / Hell-wait multiplier, bluff Riichi, table presence with temporary Furiten pressure).

### Ryuumonbuchi High (Nagano)

- **Koromo Amae**: Haitei Raoyue (last-tile miracle self-draw, shanten suppression aura, lunar cycle scaling).
- **Touka Ryuumonbuchi**: Spotlight aura + Chisui (attention economy, flood/current control, emotionless Cold Stance with instant gauge refund).
- **Momoko Touyoko**: Stealth presence (Mu - silenced discard cues, semi-transparent river, stealth Riichi).
- **Hajime Kunihiro**: Sleight of hand & misdirection (manacled defensive containment transitioning into River Mirage illusions and draw sleights).

### Tsuruga Academy & Kazekoshi Girls' School (Nagano)

- **Kaori Senoo (Tsuruga)**: Absolute novice grace (irregular starting hands, accidental Yakuman engine, immune to standard river logic).
- **Mihoko Fukuji (Kazekoshi Captain)**: Heterochromatic foresight (danger radar, shanten perception, damage mitigation and 1-turn Furiten locks).
- **Kana Ikeda (Kazekoshi)**: Cornered feline (desperation surge under , high-risk comeback carry).

### Achiga Girls Academy (Nara - Side-A Protagonists)

- **Kuro Matsumi (Vanguard)**: Dragon Road (dora magnet, severe repulsion curse if any dora is discarded; additive Dragon Force multiplier).
- **Yuu Matsumi (2nd)**: Thermal affinity (normal-type passive — Manzu/Chun draws biased x1.35, outside the Flow economy; no "chill" debuff in the implemented version).
- **Shizuno Takakamo (Captain)**: Deep Mountain (suppresses all supernatural abilities and wall manipulation in the deep wall; late-game damage dampener).
- **Ako Atarashi (Middle)**: Meld conductor (musical calling timing, turn timer choke, tempo theft without violating turn invariants).

### Senriyama Girls' High (North Osaka)

- **Toki Onjouji (Vanguard)**: Multi-turn precognition (Ichijun/Nijun/Sanjun Saki, Ippatsu Tsumo, timeline shattered by open calls).

### Himematsu High (South Osaka)

- **Kyouko Suehara (Captain)**: Tournament pragmatist (hyper-speed discards, fundamental anti-monster field suppression).
- **Hiroe & Kinue Atago (Ace & Defense)**: Sisterhood stance shift (aggressive vanguard pressure pivoting into defensive castle with emergency damage mitigation).

### Shiraitodai High (West Tokyo - National Champions)

- **Teru Miyanaga (Vanguard Ace)**: Shoumakyou mirror + Escalation Helix (turn-1 survey, ascending Tsumo streak capping in direct Yakuman value overrides).
- **Sumire Hirose (2nd)**: Target sniper (Nerai-Uchi, designated quarry focus, direct Ron strikes).
- **Takami Shibuya (Middle)**: Harvest Time (Shoukaku no Toki, first discards banked into granary to flood All-Last).
- **Awai Oohoshi (Captain - 1st-Year Monster)**: Spatial distortion (forces 5-to-6 shanten starting hands on opponents, seeded high-density Double Riichi setup, corner dead-wall control).
---

## Detailed Character Ability Mechanics

### Kiyosumi High

#### 1. Saki Miyanaga

**Thematic Passive:  (Platitude Equilibrium)**

- Mechanic: Saki gains +20% extra Flow Gauge gain on all defensive actions (folding against Riichi, discarding Genbutsu, and paying Ron/Tsumo costs).
- The Twist: If Saki’s net score delta is within of her starting score (), she receives a passive +15% draw-weight boost toward forming closed triplets (Koutsu) to facilitate Kans.
- Strategic Impact: If Saki takes a massive lead or falls into a deep deficit, this passive shuts off. Saki players balance early scores near zero to bank meter for an endgame dead-wall blow.
**Active Skill: Ridge Resonance (Rinshan Kaihou)**

*Consumes Flow Gauge upon declaring any Kan (closed or open).*

- Tier 1 (25% Flow) – Ridge Glimmer: The replacement tile drawn from the dead wall (Rinshan) has its probability of being a winning tile boosted by +45% (if that tile exists in the unseen wall). If not a win, it guarantees an effective tile (Uke-ire) that preserves Tenpai.
- Tier 2 (50% Flow) – Twin Ridges: Guarantees that the first dead-wall draw contains a tile completing an immediate second Kan. The second dead-wall draw receives a +50% chance to hit Rinshan Kaihou.
- Tier 3 (100% Flow) – Triple Summit (San Kantsu): Guarantees 3 consecutive Kans. On the 3rd dead-wall draw, the Rinshan Kaihou win rate is 80%. Revealed dead-wall Dora indicators are prioritized to match tiles already in Saki’s hand.
- Tier 4 (150% Overdrive) – Suukantsu Bounded Climax: Executes up to 4 consecutive Kans. To maintain 14-tile Wanpai engine integrity without buffer overflow, the 4th Rinshan replacement tile is deterministic:
  - If the required winning tile exists in the unseen wall, it is dynamically mapped to become the 4th Rinshan tile, delivering the legal Yakuman (Suukantsu + Rinshan Kaihou) simultaneously on draw.
  - If the winning tile has already been fully exposed in discard rivers or opponent melds, the sequence terminates safely at the 3rd Kan with a guaranteed San Kantsu + Rinshan Kaihou Baiman (8 Han) win, preventing dead-wall exhaustion.

#### 2. Nodoka Haramura

**Thematic Passive: Etopen's Anchor**

- Mechanic (Human Stance): Generates double Flow Gauge whenever playing strictly by mathematical maximum-efficiency (highest Uke-ire discard), but suffers a -10% defense penalty against trap waits (Hell-waits or Suji traps).
- The Twist (Nodocchi Mode): Once Flow Gauge reaches 50%, she enters "Nodocchi Mode."
- Becomes 100% immune to all information-distortion and vision debuffs (sees through stealth discards, blurred rivers, and fake tells).
- She cannot call Chi/Pon on tiles with statistical Expected Value below 0.
**Active Skill: Digital Execution (Theory of Probability)**

*Consumes Flow Gauge during regular draw step.*

- Tier 1 (25% Flow) – Statistical Filter: For the next 2 turns, eliminates dead terminal/honor draws with zero mathematical utility, boosting turn-efficiency toward Tenpai by +35%.
- Tier 2 (50% Flow) – Optimal Discard Calculation: Automatically calculates opponent hands and highlights the safest discard across all three opponents with 90% accuracy. Discarding the highlighted tile grants Ron immunity for that turn.
- Tier 3 (100% Flow) – Machine Shanten Compression: Compresses her hand by 1 whole Shanten step over the next 2 draws by pulling the two mathematically optimal bridge tiles from the live wall.
- Tier 4 (150% Overdrive) – Absolute EV Singularity: Grants an uninterrupted 3-turn state where every discard she makes carries a 0% deal-in risk, while her own draw weight for her winning tile is multiplied by .

#### 3. Yuuki Kataoka

**Thematic Passive: Fast-Twitch Metabolism (Taco Rush)**

- Mechanic (Round Wind Inversion):
  - East Rounds (Ton): Yuuki gains +50% Flow Gauge generation, +25% draw weight on low-value speed tiles (Tanyao/Yakuhai), and reduces turn decision timers for all players at the table to 4 seconds.
  - South Rounds (Nan - Sugar Crash): Flow Gauge generation is cut by -50%, and all points paid out on dealer/opponent wins increase by +15%.
**Active Skill: Caloric Surge (Taco Power)**

*Consumes Flow Gauge during draw or before calling an open meld.*

- Tier 1 (25% Flow) – Quick Bite: Usable on turns 1–6. Instantly pulls a single tile from the wall that completes a sequence or open meld call (Chi/Pon).
- Tier 2 (50% Flow) – Spicy Southward Defense: Usable in the South round to temporarily stave off the "Sugar Crash." Negates the -50% gauge penalty and grants immunity against 1 direct Ron call during the current hand.
- Tier 3 (100% Flow) – East Wind Onslaught: Usable only while Dealer (Oya) in East. Triples the draw weight of all East Wind honor tiles and Dora tiles for the current hand. A winning hand automatically stacks a flat +2 Han bonus.
- Tier 4 (150% Overdrive) – Ultimate Fiesta (Tanyao Blast): Guarantees a first-row (turns 1–6) Tenpai. Opponents discarding simple number tiles (2–8) have a 75% chance to deal directly into her open wait, ending the hand immediately and forcing an East 1 Repeat (Renchan).

#### 4. Mako Someya

**Thematic Passive: The Parlor Archive**

- Mechanic: Mako starts each hand with 0% gauge generation. Starting from Turn 7 (the middle pond), Flow generation increases by +15% per turn for the remainder of the hand.
- The Twist (Spectacle Removal): Activating an active skill removes her glasses. While glasses are off, she suffers -15% defense against closed Riichi hands, but gains +30% tile-reading accuracy against any player who has made open melds.
**Active Skill: Spindle Territory (Visual Memory Archive)**

*Consumes Flow Gauge during draw or discard.*

- Tier 1 (25% Flow) – Match Recognition: Compares the discard pond to historical layouts. Highlights guaranteed safe discards for 2 turns against the leading opponent.
- Tier 2 (50% Flow) – Flow Reroute: For the next 3 draws, adjusts the live wall so Mako draws tiles that mimic a winning parlor layout, increasing personal draw efficiency (Uke-ire) by +40%.
- Tier 3 (100% Flow) – River Mirroring: Targeted at one opponent. For the next 4 turns, Mako draws tiles that directly choke that opponent's discards, siphoning their tempo.
- Tier 4 (150% Overdrive) – Omnipresent Parlor Recall: Highlights every hidden Tenpai wait across all three opponents for the rest of the hand. Winning grants an automatic +1 Han / +20 Fu bonus.

#### 5. Hisa Takei

**Thematic Passive: The Gambler's Bravado**

- Mechanic (The "Bad Wait" Paradox):
  - Entering Tenpai on a multi-sided sequence wait (Ryanmen, 5–8 winning tiles live) imposes a -30% draw weight on winning tiles.

  - Entering Tenpai on an "ugly" wait (single-tile Tanki, middle Kanchan, edge Penchan, or Jigoku-machi / Hell-wait with tile remaining) multiplies draw weight for that exact tile by .

- The Twist (Showmanship Slam): When Hisa declares Riichi, opponents lose 10% Flow Gauge due to intimidation. However, dealing into an opponent while in Riichi increases point payout penalties by +25%.
**Active Skill: Hell-Wait Intimidation (Jigoku Shoushuu)**

*Consumes Flow Gauge on draw, Tenpai, or Riichi declaration.*

- Tier 1 (25% Flow) – Bluff Riichi: Can be activated while in 1-Shanten. Declares Riichi and projects a full Tenpai threat aura, biasing opponent defense toward folding for 4 turns. Standard No-ten penalty is waived at exhaustive draw.
- Tier 2 (50% Flow) – Jigoku Trap Forge: When shifting into a 1-tile wait, Hisa forces an unseen copy of that specific tile into the top 6 positions of an opponent's upcoming draws.
- Tier 3 (100% Flow) – Chaos Slap Tsumo: Usable in Tenpai on a 1-tile wait. For 3 turns, her draw weight for that remaining tile jumps to 75%. Winning via Tsumo drains 25% Flow Gauge from all opponents.
- Tier 4 (150% Overdrive) – Exhaustive Standoff / Absolute Hell: Activated when the wall drops below 20 tiles while in Hell-wait Tenpai. Rather than illegally disabling Ron prompts, the engine establishes Hell-Machi Dominance:
  - Any opponent attempting to declare Ron on Hisa's discards suffers a Damage Cap of 1,000 points (Tanyao equivalent), nullifying high-value counter-attacks.
  - Opponents who hold Hisa's winning tile are locked into Temporary Furiten for 2 rotations.
  - Hisa's Haitei (last tile) self-draw rate is set to 90%.

#### 2. Saki Miyanaga (Normal-Type Variant: Ridge Bias)

**Normal-Passive: Ridge Bias / Ridge Resonance**

*Normal-type power: always on at full strength while active, no Flow cost, no tiers, no gauge.*

- **Draw bias:** Whenever Saki holds a triplet (3 copies) of a tile in her concealed hand, the 4th copy draws at **x4.0** weight (`KAN_BIAS_WEIGHT`). Aka-aware: a `0m` copy satisfies a `5m` triplet.
- **Kan guarantee:** When Saki declares a Kan (closed, added, or open), the dead-wall replacement slot is pinned off-standard:
  - If she is *tenpai* on the kan, the exact live winning wait is placed on the Rinshan slot — a guaranteed 100% Rinshan Kaihou Tsumo on the next draw (the riichi scoring library validates the wait before pinning).
  - Otherwise the slot is pinned to an advancing tile that lowers her shanten (or keeps it flat if she is already tenpai on a losing wait), and never an exhausted tile kind.
- **Weakness (Kan Disable):** A Kan declared by any *other* player disables her power for the rest of that hand — the server fans the event out via `broadcastPlayerKan`. Her own Kan does not disable her.
- The passive is always full strength regardless of gauge, and she never participates in the Flow economy on this variant.

### Ryuumonbuchi High

#### 1. Koromo Amae

**Thematic Passive: Lunar Phase Resonance (Getsuei)**

- Mechanic (The Lunar Clock):
  - Crescent Phase (Hands 1–2): Flow Gauge generation is reduced by -25%.
  - Full Moon Phase (Hands 3–4 or Dealer streaks): Flow Gauge generation spikes by +50%. At or above 50% Flow Gauge, she reveals when opponents enter 1-Shanten or Tenpai via visual HUD pulses.
- The Twist (Lonely Child Syndrome): If an opponent wins a Haneman or higher off Koromo's direct discard, the Moon resets to "New Moon" for 2 hands (disabling aura reading and locking passive gauge gain).
**Active Skill: Oceanic Descent (Haitei Raoyue & Shanten Suppress)**

*Consumes Flow Gauge during draw or end-game turns.*

- Tier 1 (25% Flow) – Chilling Gaze: For 3 turns, opponents drawing a tile that reduces their Shanten suffer a 2-second turn-decision window due to hesitation.
- Tier 2 (50% Flow) – Oceanic Shanten Mire: For 4 turns, all opponents' draw weight for tiles decreasing their Shanten count is penalized by -40%.
- Tier 3 (100% Flow) – Haitei Gravity (Ocean Moon): When the wall drops to 15 tiles, Koromo anchors the flow. Her hand-advancing draw weight multiplies by . Opponents outside of closed Riichi have their Ron payout capped at Mangan. Her Haitei Raoyue win chance jumps to 75%.
- Tier 4 (150% Overdrive) – Submerged Abyss (Total Stagnation): Usable when entering Tenpai in the late wall (). Opponent hands are subjected to an intense Shanten chill (draw weight for Tenpai-completing tiles reduced by -80%). Koromo gains a 90% probability to draw the winning tile on her final draw before exhaustion (Haitei Raoyue), yielding a Yakuman / Baiman Tsumo.
- Counterplay: Opponent open meld calls (Chi/Pon) consume wall tiles, reducing Overdrive win probability by 25% per call.

#### 2. Touka Ryuumonbuchi

**Thematic Passive: The Spotlight (Ojou-sama's Pride)**

- Mechanic: If another player holds the lead or is in Riichi, Touka gains +30% bonus Flow Gauge generation. If Touka leads by , gauge gain drops by -20%.
- The Twist (Cold Stance Trigger): Facing high-efficiency opponents (Nodoka or Yuuki), Touka enters "Cold State." She gains immunity to intimidation and mental debuffs, but her deal-in vulnerability against stealth discards (Momoko) increases by +20%.
**Active Skill: Flood Control & Cold Execution (Chisui)**

*Consumes Flow Gauge on draw, call, or discard.*

- Tier 1 (25% Flow) – Chisui: Flow Surge: Calling Chi/Pon complies strictly with standard turn order (melded tile forms the 14th tile followed by immediate discard to maintain hand conservation). Upon executing the meld, Touka receives an instant 100% Flow Gauge refund for this skill and is permitted to reposition one concealed tile into her discard river with safe-tile priority before Ron calls resolve.
- Tier 2 (50% Flow) – River Gate (Current Control): For 3 discards across the table, opponents to her right and across are 35% less likely to draw connecting edge/terminal tiles.
- Tier 3 (100% Flow) – Cold Awakening (Pure Execution): Enters Cold State for the hand. Hand efficiency (Uke-ire) jumps by +60%, and all points won on completed hands are multiplied by .
- Tier 4 (150% Overdrive) – Grand Deluge (Chisui Cataclysm): For 2 full rotations, discards from all players are magnetically funneled to match Touka’s waiting tiles. Opponents have a 70% probability of being forced to discard directly into her wait for an inescapable Ron.

#### 3. Momoko Touyoko ("Stealth Momo")

**Thematic Passive: Negative Presence (Mu)**

- Mechanic (The Forgotten Player): Momoko's discards produce no audio cues, and river tiles appear semi-transparent and faded on opponent screens.
  - Digital Counter-Measure: Opponents in digital/analytical stances (Nodoka's Nodocchi Mode) bypass this stealth entirely.
- The Twist: While Momoko's hand is closed and unrevealed, Flow Gauge generates +25% faster. If an opponent calls Chi/Pon on her discard, her stealth shatters for 3 turns and she loses 15% Flow Gauge.
**Active Skill: Vanishing Point (Stealth Riichi)**

*Consumes Flow Gauge on draw, Tenpai, or Riichi.*

- Tier 1 (25% Flow) – Fade Out: For 3 turns, hides whether Momoko's drawn tile was kept or discarded (Tsumogiri indicator is masked).
- Tier 2 (50% Flow) – Cambered Wait: Activated when entering Tenpai. Obscures the specific numeric value of her last 2 discards in the river, inducing misjudged Suji lines and boosting deal-in chance by +35%.
- Tier 3 (100% Flow) – Silent Riichi: Declares Riichi without table slams, banners, or visible 1,000-pt sticks. Opponent HUDs do not register her Riichi state. Opponents holding a winning tile see only a subtle static distortion.
- Tier 4 (150% Overdrive) – Total Erasure (The Ghost Ron): Momoko vanishes from the table for 2 full rotations (cannot be targeted by active skills; danger rating registers 0%). Discarding into her wait during this window inflicts a direct Ron with a flat +2 Han ambush bonus.

#### 4. Hajime Kunihiro

**Thematic Passive: The Magician's Restraint (The Manacled Shark)**

- Mechanic (Chained Containment): Hajime begins every match in chained manacles as atonement for past cheating:
  - Chained State (Default): Point payouts on deal-ins are reduced by 15%, and she earns +25% bonus Flow Gauge whenever she folds or discards safe tiles (Genbutsu).
- The Twist (Unlocking the Chains): If Hajime's score drops below or Touka Ryuumonbuchi falls into 3rd/4th place at the table, her chains shatter. She trades defensive damage mitigation for offensive sleight-of-hand draw manipulation.
**Active Skill: Sleight of Hand (Prestidigitation)**

*Consumes Flow Gauge on discard or draw.*

- Tier 1 (25% Flow) – River Mirage: Rearranges the visual client projection of her discard pond for 3 turns. Discards project a false Suji aura, causing opponent danger analyzers to rate live middle tiles as low-risk safe tiles.
- Tier 2 (50% Flow) – Phantom River Swap (Visual Glamour): Rather than illegally tampering with dead-wall memory or injecting tiles into server state, Hajime casts a visual glamour over her discard river:
  - Hajime's next discard is registered accurately on the server, but client screens render it as a completely dead terminal or honor tile.
  - Opponents relying on visual river readings to calculate safe tiles (Genbutsu) fall into Furiten traps, misjudging her active waits while deterministic server logs remain 100% intact.
- Tier 3 (100% Flow) – Card Mechanic's Shuffle: For 3 turns, alters upcoming wall draws. Her next draw is guaranteed to be a tile that directly completes a concealed sequence or triplet, while opponent draws are diverted to off-suit junk tiles.
- Tier 4 (150% Overdrive) – Grand Illusion (The Phantom Ron): Activated upon declaring Riichi or entering Tenpai. For 2 rotations, Hajime masks her true winning tile behind a visual illusion of a completely different tile suit. Any opponent holding her winning tile evaluates it as 100% Genbutsu, practically guaranteeing a direct Ron hit that awards an automatic +2 Han / +30 Fu sleight-of-hand execution bonus.

### Tsuruga Academy & Kazekoshi Girls' School

#### 1. Kaori Senoo (Tsuruga Academy)

**Thematic Passive: Absolute Beginner’s Grace (Shoshinsha)**

- Mechanic: Starting hands receive a +30% bonus chance to spawn with 4+ terminal/honor tiles (Yaochuu) or 3 natural pairs. Opponents calling Ron on her discards during turns 1–5 suffer a 25% point reduction.
- The Twist: Kaori generates 0% Flow Gauge from standard defensive play (folding, reading Suji). She generates Flow exclusively when drawing isolated honors/terminals or surviving turns in 3-Shanten or worse.
**Active Skill: Miracle Chaos (Accidental Yakuman Engine)**

*Consumes Flow Gauge on draw.*

- Tier 1 (25% Flow) – Beginner’s Shuffle: For 2 turns, Kaori automatically discards her least efficient middle tile (3–7), drawing an unseen terminal or wind/dragon honor from the wall.
- Tier 2 (50% Flow) – Honor Magnetism: For 3 draws, multiplies the probability of drawing Dragon tiles (Haku, Hatsu, Chun) and Wind honors by .
- Tier 3 (100% Flow) – Kokushi Trajectory (Thirteen Orphans Alignment): If Kaori holds at least 7 unique terminal/honor tiles, her next 3 draws are guaranteed to pull missing unique terminals, pushing her into Kokushi Musou Tenpai.
- Tier 4 (150% Overdrive) – The Idiot-Savant Yakuman: Enters full novice trance. If in Tenpai on any terminal/honor Yakuman wait (Kokushi Musou, Daisangen, or Suuankou), winning draw probability spikes to 75% over the next 2 turns, unlocking an unblockable Yakuman strike.

#### 2. Mihoko Fukuji (Kazekoshi Captain)

**Thematic Passive: Maternal Foresight (The Captain's Seal)**

- Mechanic (The Closed Eye): Mihoko begins every hand with her right eye closed:
  - Generates +25% Flow Gauge from observing opponent actions (melds, Riichi calls, honor discards). Point payouts on minor deal-ins () are reduced by 15%.
- The Twist (Opening the Eye): When Flow Gauge reaches 50% or higher, she opens her heterochromatic right eye:
  - Gains Omniscient River Perception: displays exact Shanten status of all 3 opponents on HUD and grants full immunity to visual camouflage (such as Momoko's stealth).
**Active Skill: Heterochromatic Insight (Heaven’s Eye / Mirror Gate)**

*Consumes Flow Gauge on discard or opponent draw.*

- Tier 1 (25% Flow) – Danger Scan: Scans her hand against all active opponents. Highlights any tile carrying a chance of dealing into a hidden Tenpai with a red danger outline.
- Tier 2 (50% Flow) – Flow Intervention: Forces an opponent currently in Tenpai to have their next draw rerouted to an ineffective tile, delaying their winning turn by 1 rotation.
- Tier 3 (100% Flow) – Full Spectrum Vision: For 3 turns, opponent discard ponds are annotated with exact waiting tiles and danger ratings. Mihoko gains a +50% draw efficiency boost to advance her hand without breaking safe-tile rules.
- Tier 4 (150% Overdrive) – Mirror Gate Tactical Lockout: Mihoko activates absolute defensive reads for 3 full rotations:
  - Discarding into an opponent's Ron wait does not cause illegal network misfires; instead, the deal-in damage is capped to a maximum of 1,000 points (Tanyao flat base), completely insulating her against Mangan/Yakuman ambushes.
  - The opponent whose wait was triggered is placed into Temporary Furiten for 1 full rotation, forcing them to miss further win opportunities on that tile.
  - If Mihoko enters Tenpai during this window, her own winning draw probability is multiplied by .

#### 3. Kana Ikeda (Kazekoshi Girls' School)

**Thematic Passive: Cornered Feline (The Desperation Surge)**

- Mechanic (The Underdog Engine):
  - Above , plays standard Riichi with baseline draw rates.
  - When score drops below (or in 4th place), "Cat Instinct" engages: Flow Gauge generation accelerates by +60%, and all hands completed gain a natural +1 Han bonus.
- The Twist: If an opponent calls Riichi while Kana holds 1st place, she loses 15% Flow Gauge from panic, and her next draw has a 20% higher chance of being unsafe.
**Active Skill: Wildcat Counter (Ikeda Comeback Burst)**

*Consumes Flow Gauge on draw or call.*

- Tier 1 (25% Flow) – Cat Scratch: Usable only in 3rd or 4th place. Instantly draws a tile connecting into a high-scoring Dora or Aka-Dora sequence.
- Tier 2 (50% Flow) – Desperation Shanten Compression: Usable under . Compresses 1 Shanten step over the next 2 turns, drawing high-value tiles (Dora, honors) from the wall.
- Tier 3 (100% Flow) – Sanbaiman Roar: Usable in Tenpai while trailing in last place. For 3 turns, winning draw weight is boosted by +65%. Winning forces the hand payout to a minimum of Haneman (6 Han) or Sanbaiman (11 Han) if already high-value.
- Tier 4 (150% Overdrive) – Nine-Lives Reversal: Usable when at risk of elimination (). Payouts on direct deal-ins are capped at 1,000 pts for 3 turns. Her next drawn tile is guaranteed to hit Tsumo on a completed high-value hand, draining maximum points from all 3 opponents simultaneously.

### Achiga Girls Academy

#### 1. Kuro Matsumi (Vanguard)

**Thematic Passive: Dragon Road (Dora Magnetism)**

- Mechanic (The Dora Siphon): Starting hands and ongoing draws receive a probability multiplier to pull live Dora tiles (standard Dora, Aka-Dora, and Kan Dora).
- The Twist (Dora Abandonment Penalty): Discarding an active Dora tile triggers a brutal Dora Repulsion debuff for the next 2 hands: Dora draw probability drops to , Flow Gauge generation is cut by -40%, and opponents gain a chance to draw the Dora tiles instead.
**Active Skill: Dragon's Hoard (Dora Convergence)**

*Consumes Flow Gauge on draw.*

- Tier 1 (25% Flow) – Dora Beckon: If a Dora indicator is revealed, Kuro's next draw has a +50% chance to pull that Dora tile directly from the unseen live wall.
- Tier 2 (50% Flow) – Aka-Dora Resonance: For the next 3 draws, targets red-five Aka-Dora in the wall, pulling up to 2 red fives into her hand.
- Tier 3 (100% Flow) – Dragon Roar (Dora Inundation): Calls an existing Kan or declares Tenpai. Locks the next 2 draws to pull remaining active Dora indicators matching tiles in her concealed hand, inflating hand value to minimum Baiman (8+ Han).
- Tier 4 (150% Overdrive) – Absolute Dragon Empress (Dragon Force Surge): Over the next 2 turns, winning draw weight is boosted to 75%.
  - Rather than illegally rewriting predetermined dead-wall Ura-Dora indicators in server memory, the engine leaves the physical dead wall intact and injects an additive +6 Han (Dragon Force Haneman Multiplier) directly into her winning resolution.
  - This guarantees an authentic, server-validated Sanbaiman (11–12 Han) or Counted Yakuman (Kazoe Yakuman, 13+ Han) without corrupting match replay deterministic logs.

#### 2. Yuu Matsumi (2nd / Deputy)

**Normal-Passive: Thermal Affinity (Warmth of Characters & Dragons)**

*Normal-type power: always on at full strength, no Flow cost, no tiers.*

- Mechanic: Draw weight is multiplied by **x1.35** on every warm tile — the Manzu (Characters) suit (1m–9m, including Aka-Dora `0m`) and the Red Dragon (Chun, `7z`). All other draws are neutral (`x1.0`).
- She lives entirely outside the Flow economy: gauge stays pinned at `0`, never accumulates, never drains, and tier commands are ignored for her seat.
- Contributes to Hon'itsu / Chin'itsu Manzu and Chun waits without any strategic overhead — the twist is that she simply *is* warm: no "chill" debuff or metered tradecraft exists in the implemented version.

#### 3. Shizuno Takakamo (Captain)

**Thematic Passive: The Mountain Depths (Deep Wall Neutralizer)**

- Mechanic (The Anti-Supernatural Zone):
  - Turns 1–11 (Early/Mid Game): Flow Gauge generation is standard; no wall manipulation.
  - Turn 12+ / Last 30 Tiles (The Deep Wall): Activates the "Deep Mountain." In this zone, all opponents' supernatural draw weights, tile magnetism, and guaranteed win scripts are dampened by 70%.
- The Twist: Extremely vulnerable to early blitzkrieg rushers (Yuuki) aiming to win within the first 6–8 turns before the Mountain awakens.
**Active Skill: Mountain Path Command (Wall Unification)**

*Consumes Flow Gauge on draw or in late turns.*

- Tier 1 (25% Flow) – Trail Cleansing: Immediately cleanses active vision or information debuffs affecting her client HUD.
- Tier 2 (50% Flow) – Deep Trail Ascent: Usable when the wall is below 35 tiles. Increases Shizuno's draw efficiency (Uke-ire) by +45% while advancing the table's "Deep Mountain" dampening effect by 5 turns.
- Tier 3 (100% Flow) – Mountain Sovereignty (Zone Lockdown): Locks the wall when remain. For 4 turns, completely silences all opponent active skills and passives (100% suppression) while Shizuno alone receives an un-dampened +50% draw weight.
- Tier 4 (150% Overdrive) – Apex of Mount Achiga (Mountain Sanctuary): Activated in the final 15 tiles of the wall. Preserving the integrity of Ron declarations without toxic total game lockouts:
  - Discarding into opponent waits inflicts a strict Damage Dampener: deal-in damage is capped at 1,000 points.
  - Opponents entering Tenpai in this zone are placed in Late-Wall Hesitation (Turn timers slashed to 2 seconds).
Shizuno gains an 85% chance to draw her winning tile on the penultimate or final turn, taking the hand through a crushing late-wall Tsumo.

#### 4. Ako Atarashi (Middle / Center)

**Thematic Passive: Melodic Cadence (The Meld Conductor)**

- Mechanic (Rhythm & Tempo Theft):
When Ako calls an open meld (Chi/Pon), the player who discarded the called tile loses 2 seconds of decision time on their next turn, and their next draw utility is reduced by -20%.

Each completed meld grants Ako a stacking +10% Flow Gauge generation for the rest of the hand.

- The Twist: Each open meld exposes her hand: she suffers a stacking +8% increase in point damage taken if she deals into an opponent's closed Riichi.
**Active Skill: Rhythmic Shift (Cadence Manipulation)**

*Consumes Flow Gauge on opponent discard or draw.*

- Tier 1 (25% Flow) – Staccato Rhythm (Priority Tempo): Adheres strictly to standard Riichi seat calling constraints (Chi from Kamicha only; Pon/Kan from any seat). When Ako executes any call, the player whose tile was claimed has their turn-decision window reduced to 1.5 seconds for their subsequent turn, and Ako gains an immediate +1 Han bonus on completed speed hands.
- Tier 2 (50% Flow) – Tempo Choke: Upon completing an open meld, forces the next player's draw to be an ineffective terminal or honor tile from the live wall.
- Tier 3 (100% Flow) – Allegro Rush (Lightning Tanyao/Yakuhai): For 3 turns, draw efficiency for speed melds (Tanyao, Yakuhai) spikes by +70%. Opponents attempting to declare Riichi must pay double the Riichi stick cost (2,000 pts).
- Tier 4 (150% Overdrive) – Grand Symphony (The Rhythmic Blitz): For 4 turns, Ako's open calling potential reaches peak efficiency without desynchronizing network turn loops:
  - Every meld called grants an immediate Turn Choke (slashing the discarded player's timer and locking their Flow gain for 1 turn).
  - Rather than creating an illegal 15-tile Taahai hand, Ako maintains strict tile counts () while each meld adds a stacking +1 Han tempo escalation, transforming rapid open hands into lethal Mangan or Haneman finishes.

### Senriyama Girls' High

#### 1. Toki Onjouji (Vanguard Prodigy)

**Thematic Passive: Fragile Oracle (Frail Precognitive)**

- Mechanic (The Foresight Rhythm): While no open calls (Chi/Pon/Kan) occur, Toki maintains sync with the deterministic live wall. Flow Gauge charges +25% faster, and declaring Riichi gives an inherent +40% bonus probability to hit Ippatsu.
- The Twist (Physical Exhaustion & Disruption Shatter):
  - Call Vulnerability: The instant any player declares an open meld (Chi/Pon/Kan), the timeline splinters. Toki's precognition collapses: her next draw is randomized, and she loses 10% Flow Gauge.
  - Physical Toll: Activating Tier 2 or higher skills drains 1,000 points from her personal score if she fails to win that hand.
**Active Skill: Chrono Perception (Ichijun Saki / Future Sight)**

*Consumes Flow Gauge on draw, Tenpai, or Riichi.*

- Tier 1 (25% Flow) – One Turn Ahead (Ichijun): Displays an ethereal ghost preview of her exact next draw and the next discard of the player to her left, planning turns with 100% certainty.
- Tier 2 (50% Flow) – Two Turns Ahead (Nijun): Extends forecast to 2 full rotations (showing her next 2 draws and upcoming danger discards across the board). Declaring Riichi here raises Ippatsu draw weight to 70%, provided no call interrupts.
- Tier 3 (100% Flow) – Three Turns Ahead (Sanjun Collapse): Projects 3 full turns into the future, highlighting all hidden waits across the board. Winning draw weight multiplies by .
  - Toll: If the hand ends in an exhaustive draw or she deals in, Flow Gauge generation is locked at 0% for the next hand.
- Tier 4 (150% Overdrive) – Singularity of Destiny (Ippatsu Tsumo Miracle): Locks the table into an immutable timeline. Open calls (Chi/Pon/Kan) are disabled for all opponents for 1 full rotation. Toki declares Riichi, and the engine guarantees her winning tile arrives on the very next draw, scoring an unavoidable Riichi + Ippatsu + Menzen Tsumo strike with an automatic +2 Han temporal bonus.

### Himematsu High

#### 1. Kyouko Suehara (Captain)

**Thematic Passive: Tournament Grit (Kansai Pragmatist)**

- Mechanic: Zero supernatural aura, but elite tournament-tested fundamentals:
  - Gains +25% bonus Flow Gauge generation when making fast, mathematically optimal discards within 2 seconds.
Reads supernatural match tempo: if an opponent possesses an active supernatural aura or charges a high meter, Kyouko's defense resistance against their direct Ron calls increases by +15%.

- The Twist: When seated against reality-warping monsters (Saki, Koromo, Teru), activating a Tier 3+ skill inflicts cognitive overload on Suehara: her own draw efficiency (Uke-ire) is penalized by -10% for 2 turns as she over-hedges against miracles.
**Active Skill: Strategic Blitz (Information & Velocity)**

*Consumes Flow Gauge on draw, call, or discard.*

- Tier 1 (25% Flow) – Quick Read (Pond Scouting): Scans opponent discard ponds against competitive templates, identifying the single safest suit on the board with 90% accuracy for 3 turns.
- Tier 2 (50% Flow) – Velocity Snip (Fast Hand Acceleration): Pulls a sequential bridge tile from the wall to instantly jump into Tenpai, cutting off slow high-value setups.
- Tier 3 (100% Flow) – Tempo Choke (Disruptive Speed): For 3 rotations, all players' turn decision timers are slashed to 2.5 seconds. Any player running out of time auto-discards (Tsumogiri). Kyouko's own winning draw probability is boosted by +50%.
- Tier 4 (150% Overdrive) – The Captain’s Counter-Assault (Anti-Monster Checkmate): For 3 turns, all supernatural draw-weight bonuses and tile magnetism across the entire table are suppressed to 0%. Winning during this window grants an automatic +2 Han / +30 Fu tactical execution bonus, crushing table leaders with pure fundamentals.

#### 2. Hiroe & Kinue Atago (Ace & Defense Anchor)

**Thematic Passive: Sisterhood Synergy (Kansai Bravado)**

- Mechanic (Dynamic Stance Shifting):
  - Hiroe Stance (Offensive Vanguard - Default): Generates +20% extra Flow Gauge when pursuing open hands and pushing forward into danger. Discards trigger false danger alarms on opponent assist meters.
  - Kinue Stance (Defensive Anchor): Activates automatically whenever score drops below or an opponent declares closed Riichi. Payouts on deal-ins are reduced by 20%, and safe-tile draw rates increase by +30%.
- The Twist: In Hiroe (Offensive) Stance, pushing through against an opponent's Riichi imposes a -15% defense penalty for 2 turns if she refuses to fold.
**Active Skill: Atago Dominance (Kansai Whirlwind)**

*Consumes Flow Gauge on draw, call, or Riichi.*

- Tier 1 (25% Flow) – Sister’s Warning (Kinue's Guard): Highlights the safest tile in her hand against all declared threats for the current turn.
- Tier 2 (50% Flow) – Kansai Push (Hiroe's Drive): Guarantees that her next 2 draws advance her hand toward Tenpai (Uke-ire), bypassing defensive locks.
- Tier 3 (100% Flow) – Ace Vanguard Rush: Activated upon declaring Riichi. For 2 turns, winning draw weight (Tsumo) multiplies by , and opponents cannot call Chi/Pon on her discards.
- Tier 4 (150% Overdrive) – Unbreakable Castle of South Osaka: Combines Hiroe's firepower with Kinue's defense for 3 turns. Rather than breaking Oshihiki with total Ron bans, any deal-in she incurs is mitigated by 80% (capped at 1,000 points). Winning during this window inflicts a 50% Flow Gauge drain across all three opponents and grants an automatic +2 Han / +20 Fu bonus.

### Shiraitodai High

#### 1. Teru Miyanaga (Vanguard Ace & Inter-High Champion)

**Thematic Passive: Shoumakyou (Mirror of the Demonic Realm) & The Escalation Helix**

- Mechanic (The Observation Turn & The Winning Streak):
- Phase 1: Shoumakyou (Hand 1 Scouting): During the first hand, Teru generates 0% natural Flow Gauge and cannot win via Ron. Instead, she surveys the table. For every opponent activating an active skill, entering Tenpai, or calling melds, Teru logs their tendencies, permanently gaining a stacking +10% defense resistance against that player for the match.
- Phase 2: The Escalation Helix: Winning her first hand engages the Escalation Helix. Subsequent wins in an unbroken streak forcibly increase in base scoring tier:
  - Wins are heavily biased toward Menzen Tsumo, draining equal points from all three opponents.
- The Twist (Streak Shatter): If an opponent scores any win or forces an exhaustive draw where Teru is not in Tenpai, the Escalation Helix instantly resets to Stage 0.
**Active Skill: Absolute Dominion (The Endless Escalation)**

*Consumes Flow Gauge on draw, Tenpai, or round start.*

- Tier 1 (25% Flow) – Shoumakyou: Piercing Reflection: Focuses her mirror on an opponent for 3 turns, revealing their Shanten distance and Tsumogiri status. Teru's hand-advancing draw weight increases by +35%.
- Tier 2 (50% Flow) – Helix Momentum: Usable after winning hand. Guarantees hand structure naturally accommodates at least +1 additional Han (prioritizing Dora, Pinfu, or flushes) and boosts winning draw chance by +50%.
- Tier 3 (100% Flow) – Unbroken Orbit (The Tsumo Mandate): Usable in Tenpai during an active streak. For 3 rotations, live wall filters dead tiles, granting a 75% probability to hit Menzen Tsumo. Opponents cannot call Chi/Pon on discards.
- Tier 4 (150% Overdrive) – Escalation Capstone (Ascending Yakuman Surge): Usable on Streak Hand 5 or higher.
  - Rather than demanding impossible 136-tile wall rewrites to assemble a physical shape mid-hand, the engine applies an Active Hand Value Override:
  - Unseen live wall draws are heavily weighted (90% Tsumo probability) toward completing Teru's active closed wait.
  - When she wins, the engine applies a Flat Score Override to Yakuman value (32,000 pts / 48,000 pts Oya), regardless of whether the hand is an official Yakuman pattern, fulfilling the narrative inevitability of Chuuren Poutou safely within the rules engine.

#### 2. Sumire Hirose (Deputy)

**Thematic Passive: The Master Archer (Nerai-Uchi / Target Sniping)**

- Mechanic (The Target Lock): At the start of each hand, Sumire designates one specific player as her Designated Target:
  - Winning tile waits have a draw attraction into the Target's hand, heavily tempting them to draw and discard her winning tile.
  - Calling Ron on her Designated Target increases point payout by +25% and drains 20% of their Flow Gauge.
- The Twist: Non-targeted opponents declaring Riichi inflict a -20% defensive penalty on Sumire, and her target lock breaks if she folds or deals into an untargeted opponent.
**Active Skill: Piercing Arrow (Sharpshooter’s Release)**

*Consumes Flow Gauge on draw, Tenpai, or opponent discard.*

- Tier 1 (25% Flow) – Bowstring Tension: Scans Designated Target's river for 3 turns, highlighting their most frequently discarded suits and boosting Sumire's draw efficiency within those suits by +30%.
- Tier 2 (50% Flow) – Arrowhead Calibration: Activated when in Tenpai. Over the target's next 2 turns, their probability of drawing Sumire's winning tile from the wall increases by +45%.
- Tier 3 (100% Flow) – Nerai-Uchi: Heartseeker Shot: Places the Designated Target under the Sniped State for 4 turns: target's safety evaluation and Suji logic are scrambled on HUD, and discarding into Sumire's wait yields an unavoidable Ron with +1 Han / +20 Fu.
- Tier 4 (150% Overdrive) – The Tiger Princess Release (ToraHime Apocalypse): Locks onto all three opponents simultaneously for 3 turns. Discard river appears completely safe (0% danger rating). Any opponent discarding into her wait suffers a devastating Direct Ron Haneman / Baiman, transferring 100% of the point cost onto the dealing player while refunding 50% of Sumire's Flow Gauge.

#### 3. Takami Shibuya (Middle / Center)

**Thematic Passive: The Autumn Granary (Harvest Time / Shoukaku no Toki)**

- Mechanic (Seed Sowing & The All-Last Inundation):
  - Seed Planting (Hands 1 through All-Last - 1): The very first tile Takami discards on Turn 1 of each hand is banked as a "Harvest Seed" (up to 6–8 unique tiles). In early hands, she plays conservative support (+10% baseline gauge, 15% deal-in damage reduction).
  - The Great Harvest (All-Last Activation): In the final hand (All-Last), every banked Harvest Seed is dynamically prioritized to return to her hand: starting hand and first 4 draws have a probability weight to draw those exact tiles, effortlessly assembling Yakuman or high-Han configurations.
- The Twist: In short matches or games ending early via bankruptcy (Tobu), the harvest never ripens, rendering her accumulated seed library useless.
**Active Skill: Granary Management (Reaping the Field)**

*Consumes Flow Gauge on discard, draw, or in All-Last.*

- Tier 1 (25% Flow) – Crop Inspection: Displays Harvest Seed inventory on HUD and grants +25% defense resistance against deal-ins for 3 turns.
- Tier 2 (50% Flow) – Early Gleaning: Usable prior to All-Last if trailing by . Pulls 2 random Harvest Seeds into her hand over her next 2 draws.
- Tier 3 (100% Flow) – Fertile Earth: Usable during turns 1–4. Banks up to 2 additional tiles discarded during opening rotations into her Granary and refills 25% Flow Gauge.
- Tier 4 (150% Overdrive) – The Golden Bountiful Autumn (Absolute Harvest): Activated in All-Last. Floods hand with banked Harvest Seeds over the next 3 draws. Opponents' winning draw weights are reduced by 50%. If Takami reaches Tenpai on Harvest tiles, winning draw chance is boosted to 85% with an automatic +2 Han / +40 Fu multiplier.

#### 4. Awai Oohoshi (Captain & 1st-Year Monster)

**Thematic Passive: Spatial Distortion (The Cursed Starting Wall)**

- Mechanic (The 5-to-6 Shanten Curse): At the start of every hand where Awai has Flow Gauge, the engine applies an initial distribution penalty to all three opponents:
  - Opponents are heavily biased to deal with fragmented 5-Shanten or 6-Shanten hands with initial pair/sequence counts reduced by -40%.
  - Awai's starting hand is curated to sit within 1-Shanten or 2-Shanten.
- The Twist: If an opponent overcomes the terrible start and declares Riichi before Awai enters Tenpai, Awai suffers an "Ego Shock": loses 20% Flow Gauge and Double Riichi skills are locked out for that hand.
**Active Skill: Sovereign of the Corner (Double Riichi & Dead-Wall Cornering)**

*Consumes Flow Gauge on turn 1, draw, or Riichi.*

- Tier 1 (25% Flow) – Corner Wall Squeeze: Forces opponents to draw exclusively from the cold outer corners of the wall (low-utility terminals and guest winds) for 3 turns.
- Tier 2 (50% Flow) – Turn-1 Seeded Resonance (Pre-Deal Tenpai Bias):
  - Rather than illegally swapping physical hand tiles mid-turn, if Awai enters the hand with Flow Gauge, the server-side deck shuffler biases her initial 13-tile deal with dense block cohesion (0-Shanten or 9-tile Uke-ire 1-Shanten).
  - This delivers an 80% natural probability of entering Tenpai on Turn 1 for an authentic, rules-compliant Double Riichi (W-Riichi) declaration without violating tile conservation.
- Tier 3 (100% Flow) – Four-Corner Multiplier (Corner Dora Bonus): Usable upon declaring Riichi/Double Riichi. Rather than rewriting memory pointers for the dead wall, Awai’s winning resolution gains an automatic additive +4 Han ("Corner Force") modifier, simulating a quadruple Ura-Dora payout without desyncing anticheat logs.
- Tier 4 (150% Overdrive) – The Queen's Dominion (Double-Riichi Yakuman Gate): Declares Turn-1 Double Riichi with an unblockable aura: opponents' decision timers are cut to 2 seconds and open calls are disabled for 2 rotations. Her winning self-draw probability is set to 85%, delivering a Double Riichi + Ippatsu + Menzen Tsumo + Corner Force strike (Sanbaiman / Counted Yakuman).

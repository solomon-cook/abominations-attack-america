# Mutation and Military Research Card Audit

Audit started: 2026-09-26. Scope: all 32 cards (16 Mutation, 16 Military Research).

## Current verdict

The previous 2026-09-20 blanket claim that every card works is superseded. All 32 are flagged implemented in the card definition catalogue, and implementation paths exist, but that does **not** prove correct rules, timing, ownership or frontend usability. This audit remains incomplete: Fins and Gills, Rampage, Radiation Field, Atomic Recovery, Berserk, War Spikes, Atomic Breath, Molecular Cannon, Cutbacks and Son of a Monster have passing backend/local frontend evidence and authenticated room regressions; other card checks and authenticated online browser coverage are pending. Toxicor's separate monster ability now presents its two-card choice for both Mutation-site and combat-triggered draws.

Confirmed code restrictions/mismatches are marked GAP below; REVIEW marks a concern requiring a focused reproduction. Other cards have implementation evidence but still require verification. Do not interpret an unchecked item as a missing implementation.

## Verification log

- 2026-09-26: Engine tests passed (211), API tests passed (77); web/API type checks passed. Markdown link validation, production web build and final `git diff --check` remain to be rerun after this turn's card changes. Build reports the existing large JavaScript chunk advisory (660.93 kB minified). Focused Fins and Gills, Rampage, Radiation Field, Atomic Recovery, War Spikes, Atomic Breath, Iron Stomach and Toxicor UI render checks passed.
- 2026-09-26, Molecular Cannon: Chrome opened the real `SheetCards` UI on a player-projected battle, listed all three configured lairs, selected Seattle and clicked Play. The engine rolled, moved Zorb, discarded Molecular Cannon, cleared the battle and returned no browser errors. Authenticated online submission remains open.
- 2026-09-26, Molecular Cannon: authenticated room-store regression accepts the card command from the current player's session, rejects the other authenticated player as out of turn, and confirms the moved monster and revision after a fresh room read.
- 2026-09-26, Stabilizer Ray: corrected timing to arm at battle start and ask the holder to choose after the first military damage, from the Mutation cards available at that instant. A miss does not create a choice; the selected card is discarded and the prior battle decision resumes. Engine coverage checks discard lifecycle, cardholder permissions, miss behavior, and resumption.
- 2026-09-26, Stabilizer Ray: local UI projection verifier renders the battle-start play action and the post-damage discard buttons. Authenticated Memory and Prisma room tests verify the choice survives refresh, rejects the non-active player, and restores the pending retreat after selection. An authenticated browser click-through remains pending.
- 2026-09-26, Cutbacks: backend now removes any other player's face-up Research card from play, leaves it out of the discard pile, and consumes Cutbacks. Engine regressions cover opponent targeting, missing targets and illegal timing; the authenticated room-store regression rejects the other player, accepts the holder's command and confirms the removed card after refresh. The projected `SheetCards` action builder exposes `Player 2's Guard Commander` as a selectable target while the private opponent `researchCardIds` stays empty. Browser interaction in an authenticated session remains pending.
- 2026-09-26, Cutbacks local frontend: `npm run verify:cutbacks-ui` server-renders the actual `SheetCards` component from an opponent-redacted player projection and confirms the opponent's face-up Guard Commander is shown as a playable target.
- 2026-09-26, Berserk / Son of a Monster: engine tests now allow the defending monster's owner to discard and use the card during Fight, and either monster participant to use it in a Challenge. Challenge attacks by the current attacker increase immediately; attacks for the defending monster are stored and added when its turn begins. Son's Health is applied at play time and capped by max Health. Both cards enter the mutation discard pile. `npm run verify:mutation-ui` renders enabled owner controls from redacted Fight views and the actual Challenge arena control; authenticated API tests prove an off-turn monster owner can submit and refresh after both uses, in both the memory and Prisma-backed room paths. Authenticated browser clicks remain pending.
- 2026-09-26, Berserk / Son of a Monster authorization: room-store coverage verifies a defending owner can submit in Fight and Challenge while the other player is rejected; Prisma-backed store coverage verifies the off-turn Fight permission as used by persistent rooms.
- 2026-09-26, Berserk / Son of a Monster frontend authorization: the authenticated owner projection exposes an enabled Fight or Challenge hand action while the active opponent's view redacts the card. Memory and Prisma room regressions confirm the owner's action and refreshed result. The actual `RevealedCardsPanel` and `ChallengeMutationControls` are rendered from owner projections by `npm run verify:mutation-ui`.
- 2026-09-26, Fins and Gills: using the human-audited board, the backend regression verifies a Zorb's direct move across a sea barrier is absent without the Mutation and legal while it is face up. It also verifies +1 Defense only while the monster occupies a space touching a water-barrier edge, and that the bonus disappears on an ordinary space or after card removal. An authenticated room projection exposes the card and effective Defense to both seats and preserves it across refresh. The actual `SelectedPieceTray` renders effective Defense 5 in the matching player projection; `npm run verify:fins-and-gills-ui` passed.
- 2026-09-26, Rampage: the backend return-from-lair regression confirms an ordinary monster spends its Move step, while a monster with face-up Rampage returns at its assigned lair without spending movement and can legally move that turn. The authenticated room regression verifies that the player projection exposes a legal route, rejects the other seat, accepts the active owner's move and preserves the destination after refresh. `npm run verify:rampage-ui` renders the actual `MovementChecklist` with an enabled Move control and contrasts it with the spent ordinary return.
- 2026-09-26, Radiation Field: a roll of 1 destroys the military attacker even on a miss. The engine tests also confirm a cruise missile still draws its Mutation before Radiation Field removes it. The authenticated battle regression verifies that an off-turn monster owner's face-up effect is projected publicly, the other seat cannot resolve the battle, and attacker removal and card visibility persist after refresh. The actual battle `AttackRoll` renders both attacker destruction and the missile's Mutation draw with `npm run verify:radiation-field-ui`.
- 2026-09-26, Atomic Recovery: fixed missing turn-start feedback by carrying an `atomicRecovery` event flag when an injured monster is restored; the Move prompt now announces the recovery. Engine regressions verify it waits until that player's turn, restores only Health below starting value, leaves higher Health untouched and keeps the card face up. An authenticated room regression confirms the opposing active player can pass Deploy, the owning monster heals before Move and the owner sees the healed state and card after refresh. `npm run verify:atomic-recovery-ui` renders the actual turn prompt.
- 2026-09-26, War Spikes: engine regressions verify exactly 4 damage for ordinary monster hits and 5 for natural-six smashes in both military combat and Challenge. `npm run verify:war-spikes-ui` confirms effective Damage 4 in the selected-monster tray and visible 4/5 damage in the fight roll panel. An authenticated room test verifies both players' projected effective stats, the resolved 4-damage hit and refreshed Mutation visibility.
- 2026-09-26, Toxicor choice: both Mutation-site and combat-triggered draws now reveal two cards and wait for the Toxicor owner to choose. The combat flow pauses before later attacks, persists the choice (including multiple queued draws), and resumes from saved combat rolls without rerolling. Engine coverage verifies an Antimatter-triggered draw, off-turn ownership, opponent redaction, return-to-deck, and round-two War Spikes activation. Authenticated Memory and Prisma regressions cover the owner-only choice and refresh; `npm run verify:toxicor-ui` renders both site and battle controls.
- 2026-09-26, Mutation discard lifecycle: Berserk, Son of a Monster and Stabilizer Ray now place discarded Mutations in the authoritative Mutation discard pile. Engine regressions verify Berserk/Son discard and Stabilizer Ray discard-on-damage.
- 2026-09-26: `npm run browser:local:verify` did not reach gameplay: its first selector waits for the removed `Start development playtest` button, while the current home screen renders `Start local game`. Direct Chrome inspection confirmed the current home screen loads without page errors. The stale verifier is not evidence for card usability.

## Evidence and completion criteria

- Rules and inventory: [cards.ts](../packages/game-engine/src/cards.ts), including sourced card transcriptions. Resolve ambiguous readings against the cited local card images and rulebook.
- Backend: [engine](../packages/game-engine/src/index.ts), especially continuous projections, combat, Challenge, useResearchCard, useMutationInBattle, draw/deploy and turn transitions.
- Frontend: [SheetCards](../apps/web/src/components/SheetCards.tsx), [PhaseActions](../apps/web/src/components/PhaseActions.tsx), [hand panel](../apps/web/src/components/RevealedCardsPanel.tsx).
- Existing regression starting points: [engine tests](../packages/game-engine/src/index.test.ts), [Challenge tests](../packages/game-engine/src/challenge-turns.test.ts), [effect tests](../packages/game-engine/src/effects.test.ts). Existing happy-path tests are not proof of all legal windows.

For each card, complete backend verification first, then exercise the real frontend. Record test/scenario names, results, code references and remaining defects under that card. Backend checks must cover valid and invalid windows, actor/target ownership, numerical effects, lifecycle/discard/removal, stacking, and ordinary combat versus Challenge where applicable. Frontend checks must demonstrate a reachable legal play with correct choices or an automatic passive effect with visible results; verify illegal states are disabled/explained and do not silently lose valid opportunities. Include local and authenticated online play, non-active owners where relevant, state synchronization and reload. Check off a stage only with evidence; use PASS, FAIL or BLOCKED verdicts, not catalogue flags.

## Monster Mutation cards

### 01. Fins and Gills
- Expected timing: Continuous; the Defense modifier is conditional on the monster's space.
- Mode: persistent.
- Initial finding: Backend already composes the card's barrier permission and conditional Defense, but the selected-monster tray displayed printed Defense only. The tray now uses projected effective combat stats.
- Scenario: Cross water barriers; +1 Defense only on qualifying spaces; movement highlights and displayed Defense agree.
- [x] Backend: `Fins and Gills crosses a sea barrier and adds Defense only in a water-barrier space` uses the human-audited board to prove the path is illegal without the Mutation and legal with it, then checks the conditional Defense and removal behavior.
- [x] Frontend local: `npm run verify:fins-and-gills-ui` server-renders the actual selected-piece tray from a player projection on a qualifying barrier space and verifies Defense 5 is visible.
- [x] Frontend authenticated online: API room test `authenticated room projections retain Fins and Gills' conditional Defense across refresh` verifies the cardholder's private hand and public Mutation projection, the effective Defense from both authenticated seats, and refreshed state.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. An interactive browser session was not needed for this passive effect; the same actual tray component is rendered from the engine player projection.

### 02. Rampage
- Expected timing: When emerging from a lair.
- Mode: persistent.
- Initial finding: Backend supports a same-turn move only when the returning monster has face-up Rampage; ordinary lair returns consume the Move step.
- Scenario: Allow movement after lair emergence and show legal destinations; normal monsters still lose that Move step.
- [x] Backend: verified the return-turn movement exception and ordinary return behavior against the sourced transcription; engine regression passes.
- [x] Frontend local: `npm run verify:rampage-ui` renders the actual movement checklist with enabled Rampage movement and a spent ordinary return.
- [x] Frontend authenticated online: authenticated room projection exposes the legal route; the active owner can move, the other seat is rejected, and refreshed state retains the destination.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. Authenticated browser click-through remains part of the broader online UI coverage.

### 03. Radiation Field
- Expected timing: Immediately after a military unit rolls 1 when attacking this monster.
- Mode: persistent.
- Initial finding: Effect applies after the roll regardless of hit result; applicable cruise-missile Mutation draws happen first.
- Scenario: Military roll 1 destroys attacker and preserves applicable mutation draw; animate/log both outcomes.
- [x] Backend: verified the roll-one destruction and the cruise-missile draw order against the sourced transcription; engine regressions pass.
- [x] Frontend local: `npm run verify:radiation-field-ui` renders the actual fight attack roll with the attacker-destroyed message and Mutation-drawn feedback.
- [x] Frontend authenticated online: the public battle projection shows the defending owner's passive card; the active battle controller resolves while the other seat is rejected, and refreshed state retains the destroyed attacker.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. Authenticated browser click-through remains part of the broader online UI coverage.

### 04. Atomic Recovery
- Expected timing: Beginning of your turn, if Health is below starting Health.
- Mode: persistent.
- Initial finding: Backend healing was correctly timed but its turn-start event omitted the effect, leaving the UI without direct feedback. The event now carries an `atomicRecovery` flag and the Move prompt reports the heal.
- Scenario: Heal to starting Health only at turn start when below it; do not reduce higher Health; display updated Health.
- [x] Backend: engine regressions verify turn-start timing, exact restoration below starting Health, no change above starting Health, and no premature heal during Move.
- [x] Frontend local: `npm run verify:atomic-recovery-ui` renders the actual Move prompt's turn-start recovery feedback.
- [x] Frontend authenticated online: authenticated room test verifies turn ownership, automatic healing during turn transition, visible card, and refreshed Health.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS.

### 05. Berserk
- Expected timing: Any time during a battle involving this monster.
- Mode: one-use/discard.
- Initial finding: GAP fixed: Fight now permits the owner of a defending monster to use the card, and Challenge accepts either monster participant during an active duel. The defending monster's Challenge attacks are banked for its next turn.
- Scenario: Discard this card for 5 extra attacks at any time during a battle you're in.
- [x] Backend: `a defending monster may use Berserk during another player's Fight` and `Berserk and Son of a Monster can be used during either participant's Challenge battle` cover off-turn ownership, extra attacks, deck discard and Challenge turn handoff.
- [x] Frontend local: `npm run verify:mutation-ui` renders enabled Berserk controls from an owner projection during Fight.
- [x] Frontend authenticated online: the owner’s authenticated player projection contains the card and pending battle window; `verify:mutation-ui` renders enabled Fight/Challenge controls from those projections, while Memory and Prisma room tests authorize the defending owner, reject the other seat, and preserve the added attacks after refresh.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. Full authenticated browser click-through remains part of the broader online UI coverage.

### 06. War Spikes
- Expected timing: Whenever this monster deals damage with a hit.
- Mode: persistent.
- Initial finding: The shared damage projection replaces printed damage with 4; natural-six smash adds 1 to that result. The fight roll explanation omitted total smash damage, so it now reports the total explicitly.
- Scenario: 4 damage per hit in military battles and Challenge; verify smash interactions and displayed damage.
- [x] Backend: engine regressions verify ordinary hits deal 4 in military combat and Challenge and a natural 6 deals 5; miss behavior and the continuous replacement policy remain covered by shared effect tests.
- [x] Frontend local: `npm run verify:war-spikes-ui` renders effective Damage 4 and the actual fight roll panel's 4-damage and 5-damage smash results.
- [x] Frontend authenticated online: authenticated room projections expose effective Damage 4 to both seats; the online battle command records a 4-damage hit and a refreshed opponent projection retains the face-up Mutation and effective stat.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. Authenticated browser click-through remains part of the broader online UI coverage.

### 07. Atomic Breath
- Expected timing: First combat round of each battle.
- Mode: persistent.
- Initial finding: Shared battle stats added one attack to round one, but the attack playback had no marker attributing that roll to Atomic Breath. The military battle event now marks exactly the bonus roll; Challenge retains a two-attacks-in-round-one, one-in-round-two allowance.
- Scenario: Exactly one extra attack in first round of each military battle and Challenge; no bonus in later rounds.
- [x] Backend: `Atomic Breath adds exactly one first-round attack in military battles, but none in round two` and `Atomic Breath adds one Challenge attack in round one of every duel only` verify both battle modes, later-round boundary, persistent card, and repeat duel timing.
- [x] Frontend local: `npm run verify:atomic-breath-ui` renders the actual marked extra attack in `AttackRoll` and the Challenge attack allowance as two attacks in round one and one in round two.
- [x] Frontend authenticated online: `authenticated Atomic Breath battle controls expose the extra first-round attack` verifies current-seat authorization, round-one attack total of two through the authenticated command flow, round-two total of one after further commands, and persistence across refresh.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM FLOW PASS. The passive Mutation remains visible in the authenticated owner's projection. Broader authenticated browser click-through is still pending.

### 08. Iron Stomach
- Expected timing: When this monster stomps a military base.
- Mode: persistent.
- Initial finding: Backend choice offered the correct base rewards (+3 Health or +1 Infamy), but both UI controls mislabeled it as a Zorb city choice and displayed +2 Infamy. Encounter choices now carry their source through the pending decision/event projection so the UI labels the right rewards.
- Scenario: On base stomp offer +3 Health versus +1 Infamy; preserve owner choice and prevent repeated rewards.
- [x] Backend: `Iron Stomach lets a monster choose Health instead of military-base Infamy` verifies +3 Health versus +1 Infamy, the typed source of the choice, and that a repeated stomp cannot award the base reward again.
- [x] Frontend local: `npm run verify:iron-stomach-ui` renders the encounter overlay's correct +3 Health and +1 Infamy labels and rejects the incorrect +2 Infamy text. `PhaseActions` presents the same source-aware labels.
- [x] Frontend authenticated online: `authenticated Iron Stomach choice names the base rewards and preserves the selected Health` verifies the source survives room refresh, the off-turn seat is rejected, the owner chooses +3 Health, and refreshed state retains the result/card.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM FLOW PASS. Authenticated browser click-through remains part of the broader online UI coverage.

### 09. Whip Tentacles
- Expected timing: Immediately after this monster rolls 6 for an attack.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Each natural 6 immediately adds an attack, including chained sixes and Challenge; preserve smash.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 10. High-Octane Blood
- Expected timing: Move modifier is continuous; attack-order effect applies during the Monster Challenge.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: +1 Move and first attack in Challenge as defender; test both monsters holding ordering effects.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 11. Son of a Monster
- Expected timing: Any time during a battle involving this monster.
- Mode: one-use/discard.
- Initial finding: GAP fixed: same Fight/Challenge timing and ownership coverage as Berserk; Health resolves immediately and caps at starting Health, and the card enters the Mutation discard pile.
- Scenario: Discard this card at any time during a battle you're in to get 2 extra attacks and 1 die of Health.
- [x] Backend: shared regressions `Berserk and Son of a Monster can be used during either participant's Challenge battle` and `Berserk and Son of a Monster resolve their sourced optional battle windows` cover extra attacks, capped Health, timing and discard lifecycle.
- [x] Frontend local: `npm run verify:mutation-ui` renders enabled Son of a Monster controls from an owner projection during Challenge.
- [x] Frontend authenticated online: the owner’s authenticated player projection contains the card and Challenge window; `verify:mutation-ui` renders an enabled Challenge control, while the Memory room test authorizes the defending owner, rejects the other seat, and preserves the Health and attack bonus after use.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM PROJECTION PASS. Full authenticated browser click-through remains part of the broader online UI coverage.

### 12. Winged Horror
- Expected timing: Continuous while face up.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: +1 Move and flight in authoritative routes and board highlights; removal restores normal movement.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 13. Kinda Friendly
- Expected timing: During and immediately after this monster's movement involving National Guard units.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Pass through Guard and return Guard at final space without combat; mixed-unit spaces remain correct.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 14. Laser Beam Eyes
- Expected timing: When this monster attacks cruise missiles.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: +2 to hit cruise missiles only; check each missile type and target/dice feedback.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 15. Armored Scales
- Expected timing: Continuous while face up.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: +1 Defense and -1 Move with stacking, movement bounds and visible effective stats.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 16. It's a Robot!
- Expected timing: Immediately after another monster misses this monster during the Monster Challenge.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Challenge miss deals 1 damage to attacker; handle simultaneous defeat and visible retaliation.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

## Military Research cards

### 17. Defense Satellites
- Expected timing: Any of your turns.
- Mode: one-use/discard.
- Initial finding: REVIEW: compare all own-turn windows with pending-battle restrictions and hand-panel gating.
- Scenario: Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die for each monster on the game board. That monster takes that much damage. (This doesn't affect Captain Colossal or Mecha-Monster.)
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 18. Antimatter
- Expected timing: Start of a battle involving your units, on any of your turns.
- Mode: one-use/discard.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Military units deal double damage in the first combat round. Each time the monster is damaged this way, roll 1 die. The monster mutates on a roll of 1.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 19. Stabilizer Ray
- Expected timing: Start of a battle involving your units, on any of your turns.
- Mode: one-use/discard.
- Initial finding: GAP fixed: the previous version required choosing before damage. It now asks after the first military damage, using the monster's face-up Mutation cards that existed at that damage event; cards drawn afterward do not become retroactive targets.
- Scenario: Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. If you damage a monster during this battle, choose and discard 1 of its Mutation cards.
- [x] Backend: `Stabilizer Ray asks the cardholder to choose after military damage and resumes the battle` verifies the delayed decision, mutation discard and restored retreat. `Stabilizer Ray does not prompt or discard a Mutation when military damage misses` verifies the condition. Authenticated Memory and Prisma room tests cover persistence and actor ownership.
- [x] Frontend local: `npm run verify:stabilizer-ray-ui` renders the start-of-battle action without a premature target and the post-damage choices from a redacted player projection.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: BACKEND + LOCAL FRONTEND PASS; AUTHENTICATED ROOM COMMANDS PASS; ONLINE BROWSER CLICK-THROUGH PENDING.

### 20. Laser Fence
- Expected timing: After a monster ends its move but before battle.
- Mode: one-use/discard.
- Initial finding: GAP: original path exposed the card only to the active player's battle, required that player's units, and did not provide a post-move reaction window. The card text permits use after a monster ends its move; the face-up cardholder is the authenticated actor.
- Scenario: Use at any time when a monster ends its move, but before battle. DISCARD THIS CARD AFTER USE. The monster must expend 2 Infamy tokens or retreat to an unoccupied adjacent space. (It doesn't encounter the new space.)
- [x] Backend: `legalLaserFenceTargets` tracks each completed monster move through the pre-battle/Encounter window; payment removes exactly 2 Infamy, while retreat uses an unoccupied adjacent space, removes that monster's pending battle, skips its Encounter and preserves the rest of Move. Engine regressions cover off-turn ownership, invalid targets, payment, retreat and window lifecycle. Memory and Prisma room tests prove only the authenticated cardholder can submit the reaction and the result survives refresh.
- [x] Frontend local: `LaserFenceControls` renders payment and each legal retreat destination in Move, Fight setup and before Encounter; its player-projection verifier checks the off-turn holder sees enabled controls and no controls render outside the window (`npm run verify:laser-fence-ui`).
- [ ] Frontend authenticated online: API authorization and refreshed state are covered in both room-store tests, but an authenticated browser click-through remains to be verified.
- Verdict / evidence: BACKEND PASS; FRONTEND LOCAL PASS; ONLINE FRONTEND PENDING. `npm --workspace @abominations/game-engine test` (202 passed), `npm --workspace @abominations/api test` (64 passed), `npm run typecheck`, and `npm run verify:laser-fence-ui` passed.

### 21. Guard Commander
- Expected timing: Continuous while face up.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Holder moves/redeploys Guard with specified movement; all other players cannot deploy Guard; UI ownership agrees.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 22. Fusion Cells
- Expected timing: Continuous while face up.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: +1 Move to all holder units including special/controlled units as applicable; legal highlights reflect it.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 23. Mecha-Monster
- Expected timing: Resolve immediately when drawn; discard after placing the unit and taking its tile.
- Mode: one-use/discard.
- Initial finding: REVIEW: verify forced placement immediately on draw, base choice, occupied bases, destruction and Challenge.
- Scenario: You control the Mecha-Monster giant military unit. Place its piece on one of your bases and take its record tile. When Mecha-Monster reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 24. Cutbacks
- Expected timing: Any of your turns.
- Mode: one-use/discard.
- Initial finding: GAP fixed: the engine and UI now target another player's face-up Research card as well as your own. Metadata now reports the sourced effect as implemented.
- Scenario: Use on any of your turns. DISCARD THIS CARD AFTER USE. Remove a Research card from play.
- [x] Backend: `Cutbacks removes any player's face-up Research card from play on the active player's turn` covers opponent target removal, discard versus remove-from-play lifecycle, missing targets and illegal timing.
- [x] Frontend local: `npm run verify:cutbacks-ui` renders the actual card component from a redacted player projection and confirms Player 2's public Guard Commander appears as a target with a play control.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: BACKEND + LOCAL FRONTEND PASS; authenticated store sync passes, authenticated browser click-through pending. `npm run verify:cutbacks-ui` and the API regression `authenticated Cutbacks use can remove an opponent's public face-up Research card` provide the evidence.

### 25. X-Fighters
- Expected timing: Place both pieces on the card immediately; each may be deployed during a legal deploy in place of a branch unit.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Create two reserve pieces; substitute for branch deployment only; permanently remove destroyed pieces and discard after both.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 26. Molecular Cannon
- Expected timing: Start of a battle involving your units, on any of your turns.
- Mode: one-use/discard.
- Initial finding: FIXED: it previously played during Move, targeted any monster and only offered one assigned lair. It now requires the active battle to involve the card holder's unit, offers configured lairs for that battle's monster, discards on use, ends that monster's pending battle, and handles lethal damage by sending it to Hollywood. `legalMolecularCannonTargets` drives the hand controls without rolling during preview.
- Scenario: Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Roll 1 die. The monster takes that much damage and immediately appears on one of its lairs (your choice).
- [x] Backend: engine regression tests cover wrong timing and target, player projection, every configured lair, battle removal, discard and lethal damage; API room regression covers authenticated actor enforcement, successful use and refreshed state.
- [x] Frontend local: Chrome selected and played a legal lair choice through `SheetCards`; card discarded and pending battle cleared.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: Backend PASS (`Molecular Cannon is available only at its own battle start and offers all configured lairs`; `Molecular Cannon consumes its battle, moves the monster, and handles lethal damage`). Frontend local PASS (Chrome card UI scenario); authenticated-online evidence PENDING.

### 27. 2nd Generation
- Expected timing: During each of your Deploy steps while face up.
- Mode: persistent.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: One additional branch or Guard deploy each turn; enforce Guard Commander restrictions and reset allowance.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 28. Blonde Lure
- Expected timing: Any of your turns; constrains the chosen monster's next turn if movement is possible.
- Mode: one-use/discard.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: Choose monster and adjacent destination; constrain its next move only if possible and then expire; show restriction.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 29. Anti-Mutagen
- Expected timing: Start of any battle involving your units.
- Mode: conditional.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: At each battle start involving holder units, damage per target Mutation exactly once, including off-turn and lethal damage.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 30. Scientific Analysis
- Expected timing: Start of any battle involving your units.
- Mode: conditional.
- Initial finding: Implementation path present; correctness and frontend usability remain unverified.
- Scenario: At each battle start involving holder units, deal 1 damage exactly once, including off-turn and lethal damage.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

### 31. Chopper Lift
- Expected timing: Any of your turns.
- Mode: one-use/discard.
- Initial finding: GAP: the UI selected a monster and destination before the backend rolled; its dry-run happened to use the same deterministic seed, but did not expose the printed roll-before-choice sequence. Metadata also incorrectly marked the card source-gated.
- Scenario: Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die. Move a monster up to that many spaces. It loses 1 Infamy. It cannot end this move on a space containing another piece, on a sea space, or on an unstomped city, base, or Infamy site.
- [x] Backend: `use-research: Chopper Lift` rolls once and persists the roll before target selection; `resolve-chopper-lift` allows any living monster and only legal destinations within the rolled distance, including staying when the current space is eligible. It blocks another piece, sea and unstomped city/base/Infamy landings, charges one Infamy, discards once, and cancels a pre-combat battle if the chosen monster leaves it. Engine regression covers roll persistence, one roll, legal destinations, zero movement, Infamy loss and discard.
- [x] Frontend local: the card now offers only “Roll for Chopper Lift” first; the follow-up control shows the recorded die result, monster selector, and only backend-legal landing spaces (`npm run verify:chopper-lift-ui`).
- [x] Frontend authenticated online: Memory and Prisma room tests submit both steps as the authenticated active player, verify wrong-seat rejection (Memory), and confirm the same rolled choice survives refresh before final position, Infamy and discard synchronize.
- Verdict / evidence: BACKEND + LOCAL FRONTEND + AUTHENTICATED ROOM FLOW PASS. Engine: 203 tests; API: 66 tests; `npm run typecheck`, `npm run build`, and `npm run verify:chopper-lift-ui` passed. Memory and Prisma tests preserve the same roll across refresh; the browser verifier confirms the active player projection shows only legal destinations. `packages/game-engine/src/cards.ts` now classifies the sourced effect as implemented.

### 32. Captain Colossal
- Expected timing: Resolve immediately when drawn; discard after placing the unit and taking its tile.
- Mode: one-use/discard.
- Initial finding: REVIEW: verify forced placement immediately on draw, base choice, occupied bases, destruction and Challenge.
- Scenario: You control the Captain Colossal giant military unit. Place its piece on one of your bases and take its record tile. When Captain Colossal reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.
- [ ] Backend: verify against sourced rule; record regression evidence and fix any confirmed defect.
- [ ] Frontend local: reproduce relevant window/passive trigger; verify choices and feedback.
- [ ] Frontend authenticated online: verify actor permissions and state synchronization.
- Verdict / evidence: PENDING.

## Cross-card work and audit order

- [ ] Complete Laser Fence authenticated browser click-through; backend timing and local controls now pass.
- [x] Resolve the identified Berserk, Son of a Monster, Molecular Cannon and Cutbacks timing/target gaps at the backend boundary.
- [ ] Verify damage/choice sequence for Stabilizer Ray.
- [x] Reconcile Chopper Lift implementation metadata and player-facing roll-then-choice text.
- [ ] Verify that command legality previews do not reveal random outcomes or depend on private online state.
- [x] Verify Toxicor's Mutation-site and battle-triggered two-card choices, owner permissions, redaction and deck return; engine, Memory/Prisma room, and UI projection checks pass.
- [ ] Verify card acquisition, passive activation, removal of effects and deck/discard lifecycle.
- [ ] Complete the remaining per-card checks; update this document with evidence rather than blanket assertions.
- [ ] Run relevant engine/API regressions, typechecks and browser scenarios after fixes; record any environment blocker explicitly.
- [ ] Final tally: 32 backend verdicts and 32 frontend verdicts; no unresolved failures before goal completion.

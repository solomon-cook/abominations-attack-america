# AI opponents plan

**Status:** implementation in progress for local Solo vs bots; no network AI service.
**Roadmap source:** `TODO.md`, Milestone 15.

## User need and scope

The home screen already offers Solo vs bots, and the roadmap asks for clearly labelled opponent difficulty levels. The product need is to let a player choose an approachable or more demanding match without changing the rules or the existing online room bot-takeover behavior. This is grounded in the shipped solo entry point and owner-requested backlog; external-player difficulty calibration remains open.

## Privacy and cost

- Difficulty is a per-match local setting; no account data, personal profile, or new telemetry is needed.
- Bot choices run in the browser using the deterministic shared game engine. No model API, external service, or server compute is introduced. Measure decision latency on the full audited board and keep each bot step bounded.
- Do not persist difficulty in account data or authoritative match state; record it only in local UI state for the active solo session.

## Compatibility

- Keep the shared `GameState`, command protocol, board version, and deterministic rules unchanged.
- Preserve the current tactical bot as the default profile for existing call sites, API disconnect takeover, and tests that do not select a difficulty.
- Apply the selected profile only to solo opponent decisions. Guest online rooms, bot takeover, saves, and replay remain unchanged.

## Acceptance

- Show player-facing, descriptive labels and a concise explanation before starting a solo game.
- Make the levels observably distinct while keeping every action legal and the result authoritative.
- Use fixed seeds to compare profile outcomes over a repeatable set of audited-board matches; confirm the ordering is consistent enough to justify the labels, and tune or rename levels if it is not.
- Verify no change to default bot behavior, online takeover, board identity, or player-visible private data.

The human validation procedure is recorded in [`ai-opponent-playtest-protocol.md`](ai-opponent-playtest-protocol.md). No player sessions have been run or are implied by the protocol.

## Implementation progress — 2026-10-10

- Cached legal directed neighbours by monster movement during route scoring and replaced repeated full-edge scans/array-front removal with an indexed breadth-first queue. The route scorer keeps source edge order, per-goal shortest-path choice, and the existing score formula.
- Fixed the solo-bot verifier setup to execute the audited unused-branch placement step and to keep its research-choice fixture below the intended three-unit threshold.
- Challenging now selects stronger sourced Mutation options and uses Son of a Monster/Berserk during its own Monster Challenge turn; Casual and the default Tactical/online bot behavior are unchanged. Engine tests confirm the choices apply legally and add the sourced Health/attack effects.
- `npm run verify:solo-bots` passes. The latest local run measured one audited-board force-first deployment choice at 6.7 ms, one research-first choice at 3.6 ms, and route scoring across all four branches at 55.6 ms. These are focused local measurements, not a cross-device performance guarantee.
- The seat-swapped round-robin now covers 50 fixed seeds and 300 completed matches on `human-audited-north-america`, with 100 matches per pairing and both seat orders. Casual and Tactical each won 50 against each other; Casual edged Challenging 51–49; Tactical beat Challenging 55–45. The results do not show a clear Casual-to-Challenging strength progression and do not validate a player-perceived difficulty curve. See [`ai-opponent-profile-round-robin-2026-10-10.json`](ai-opponent-profile-round-robin-2026-10-10.json) and the earlier Casual-versus-Challenging reports [`ai-opponent-seed-benchmark-2026-10-10.json`](ai-opponent-seed-benchmark-2026-10-10.json) and [`ai-opponent-seed-benchmark-2026-10-10-post-challenge-tactics.json`](ai-opponent-seed-benchmark-2026-10-10-post-challenge-tactics.json).
- To distinguish Casual play from target-optimizing Challenge behavior, Casual now challenges the healthiest available opponent while Tactical and Challenging choose the weakest; a focused engine regression verifies that decision. The updated Casual profile completed separate 50-seed, seat-swapped comparisons against both Tactical and Challenging (200 matches total) on the audited board. Casual–Tactical finished 50–50, and Casual–Challenging finished 51–49; all 200 winner outcomes exactly match the earlier baseline for the same seeds and seat orders. This targeting adjustment has not demonstrated a relative-strength effect. See [`ai-opponent-casual-tactical-candidate-50-seed-2026-10-10.json`](ai-opponent-casual-tactical-candidate-50-seed-2026-10-10.json) and [`ai-opponent-casual-challenge-candidate-50-seed-2026-10-10.json`](ai-opponent-casual-challenge-candidate-50-seed-2026-10-10.json). The previous 50-seed Tactical–Challenging baseline (55–45) is unchanged because neither of those profiles changed. Player-perceived difficulty remains unverified; the four-seed report is retained as the earlier partial sample.
- The expanded seeds exposed two additional action-path issues: lethal Molecular Cannon damage could leave the active monster with an invalid Hollywood Encounter, and the bot could use Stabilizer Ray in a battle without its own units. Encounter suppression and the bot's ownership guard now have regression coverage. The game-engine suite passes 255 tests, typechecks pass, and the API suite passes 126 tests.
- Before a proposed Casual movement-policy change, the current-code round-robin completed all 300 matches across the same 50 fixed seeds and both seat orders. Casual beat Tactical 53–47, Casual and Challenging split 51–49, and Tactical beat Challenging 55–45. That run differs from earlier recorded seed/seat outcomes (85 of 300 against the archived round-robin; 45 of the Casual–Tactical candidate's 100 and 40 of the Casual–Challenging candidate's 100). The reference reports predate later strategy edits, so those differences are not a controlled single-change comparison. The archived report is [`ai-opponent-profile-round-robin-pre-casual-path-ranking-2026-10-10.json`](ai-opponent-profile-round-robin-pre-casual-path-ranking-2026-10-10.json).
- A proposed change making Casual choose the middle-ranked legal movement path was rejected after a partial 20-seed, 120-match round-robin: Casual lost all 40 games against Tactical and all 40 against Challenging, while Tactical and Challenging split 21–19. The remaining runs were stopped once this regression was clear. The measured pre-change policy is restored. The diagnostic candidate results are preserved in [`ai-opponent-profile-round-robin-casual-middle-path-rejected-2026-10-10.json`](ai-opponent-profile-round-robin-casual-middle-path-rejected-2026-10-10.json); the existing 50-seed report documents the restored policy. Human playtesting remains required.
- A lower-ranked Casual deployment candidate was screened against Tactical over ten fixed audited-board seeds with both seat orders. It completed all 20 matches but left the result 11–9 for Casual, exactly matching the same-seed baseline; 8 of 20 individual winners changed, and command count rose 5.9% (7,071 vs 6,676). One candidate match took 105.9 seconds for 418 commands. The candidate was rejected and the median-ranked deployment policy restored; the measurements are in [`ai-opponent-casual-low-deployment-candidate-rejected-2026-10-10.json`](ai-opponent-casual-low-deployment-candidate-rejected-2026-10-10.json). This small self-play screen does not close relative-strength calibration or human playtesting.
- A Challenging-only Berserk-timing candidate was compared against Casual across the full 50-seed audited-board set in both seat orders. Challenging used Berserk in ordinary one-unit battles; across all 100 matches, the result stayed 51–49 for Casual, exactly matching the same-seed baseline, while 40 individual winners changed and command count rose 5.95% (34,299 vs 32,372). The candidate was rejected and the prior shared Berserk timing restored. The full run is [`ai-opponent-challenging-berserk-candidate-50-seed-2026-10-11.json`](ai-opponent-challenging-berserk-candidate-50-seed-2026-10-11.json). This self-play comparison does not measure player-perceived difficulty.
- Further profile tuning and external-player playtesting remain open before presenting Casual/Tactical/Challenging as a validated difficulty curve. The larger simulation is deterministic bot self-play, not human gameplay evidence.

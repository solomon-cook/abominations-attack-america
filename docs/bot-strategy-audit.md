# Bot strategy and simulation audit

This ledger separates deterministic smoke coverage, bounded outcome samples, and strategy-quality evidence. A match cap or zero invalid commands does not prove that the bot plays well or follows the physical edition.

## Harness

Run the checked-in all-bot batch harness with:

```sh
npm run verify:bot-strategy:batch -- --seed-count=12 --max-rounds=3
```

The harness runs 3- and 4-seat matches for each seed, completes setup with the existing deterministic setup selector, and records per-match and per-seat tactic, actions, turns, Health, Infamy, branch, stomped objectives, winner/terminal state, cap outcome, and invalid-command evidence. It also counts route-scoring decision paths and samples CPU in V8. A match ends at the selected round cap, terminal state, or 2,000-action safety cap. The seed/round caps are command-line arguments; defaults are seeds 0–11 and 12 rounds.

## Bounded sample: seeds 0–11, three rounds

Captured after the route-scoring traversal optimization. The one-round baseline and before/after performance measurements are in the [performance baseline](performance-baseline.md).

| Seats | Matches | Terminal wins | Round-capped | Invalid actions | Average actions per match | Average stomped objectives |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 12 | 0 | 12 | 0 | 105.33 | 6.83 |
| 4 | 12 | 0 | 12 | 0 | 106.92 | 11.17 |

All 24 matches completed three rounds and gave each seat three turns. None reached a winner, terminal result, or safety cap; zero commands were invalid. Route scoring was counted 1,373 times, with 507.124 ms of approximate sampled inclusive CPU across 356.629 seconds of simulation wall time.

Across the 84 sampled seats, `force-first` appeared 35 times and averaged 30.43 actions, 18.91 final Health, and 3.60 final Infamy; `research-first` appeared 49 times and averaged 30.24 actions, 17.14 Health, and 4.14 Infamy. These are descriptive aggregates from a three-round capped run. They are not win-rate or tactic-quality comparisons because the matches did not reach terminal outcomes and the seat/monster/branch combinations vary.

## Full-match bounded sample: seeds 0–3, twelve-round maximum

| Seats | Matches | Terminal | Round/safety capped | Invalid actions | Average rounds | Average actions | Average stomped objectives |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 4 | 4 | 0 | 0 | 7 | 280.00 | 19.00 |
| 4 | 4 | 4 | 0 | 0 | 6 | 325.25 | 24.75 |

All eight terminal results were `monster-challenge` wins. The batch took 291.584 s, with 935 route-scoring calls and 316.963 ms approximate sampled inclusive route-scoring CPU. In the eight matches, seat 1 won five, seat 2 won two, seat 3 won one, and seat 0 won none. This small sample cannot establish seat-order advantage: fixed setup/seed assignments may explain the distribution. Add seat/monster/branch rotations and more seeds before drawing a balance conclusion.

The 28 seat samples contained 8 `force-first` and 20 `research-first` choices. `research-first` produced five winners and `force-first` three, but the uneven sample counts and correlated seat/monster/branch assignments make this unsuitable as a tactic win-rate comparison. These remain development-candidate rules and board data, not physical-edition outcome evidence.

## Shuffled setup sample: seeds 31–32 and 41–42

Run the checked-in shuffled-assignment harness with:

```sh
npm run verify:bot-strategy:shuffled
```

The harness uses a seeded PRNG to shuffle distinct monster, branch, and available lair assignments before the bots play. The default sample completed four terminal Monster Challenge matches: three-seat seeds 31 and 32, and four-seat seeds 41 and 42. They took 6, 6, 7, and 6 rounds respectively, with 188, 224, 356, and 342 actions. There were no invalid actions or round/action caps. Tomanagi won twice; Zorb and Toxicor won once each; the four winners had four distinct branches.

This is a repeatable smoke sample, not a balance estimate. Four games are too few to infer win rates or seat fairness. Setup assignments are shuffled directly, so this sample does not assess the bots' counter-pick and branch-selection decisions. Increase the seed count and rotate player counts when investigating a strategy hypothesis; compare variants against the same seeds and terminal metrics. Physical-edition rule behavior remains a separate source gate.

### Shuffled two-round execution sample: seeds 31–32 and 41–42

Reproduce the bounded sample without running matches to terminal state:

```sh
npm run verify:bot-strategy:shuffled -- --seed-count=2 --max-rounds=2
```

The exact output is retained in [`output/bot-strategy/shuffled-two-round-2026-09-28.json`](../output/bot-strategy/shuffled-two-round-2026-09-28.json). It was captured on 2026-09-28 from the overhaul worktree based on `6ec09a93a5ca`; the working tree contained uncommitted overhaul changes. The JSON records the seed/configuration, per-match and per-seat outcomes, caps, actions, and invalid-action evidence.

This run used the existing action selector with the seeded shuffled monster, branch, and lair assignments listed below. All four matches reached the two-round cap, each seat completed two turns, and none had an invalid action or safety-cap termination. There were no terminal matches or winners.

| Seats | Seeds | Matches | Turns per seat | Actions per match | Invalid actions | Terminal matches |
| ---: | :--- | ---: | ---: | :--- | ---: | ---: |
| 3 | 31, 32 | 2 | 2 | 56, 61 | 0 | 0 |
| 4 | 41, 42 | 2 | 2 | 77, 74 | 0 | 0 |

This is repeatable behavior and command-validity evidence only. The short cap does not reach Monster Challenge, so it cannot evaluate Challenge behavior, terminal outcomes, balance, or which tactic performs better. No strategy variant is compared in this bounded run; a paired full-match comparison is too expensive for routine acceptance, and applying a Challenge-only policy to this sample would not measure its effect. These outcomes also do not establish alignment with physical-edition rules.

The earlier three-round and terminal-sample tables in this document are historical written summaries; their raw outputs and revision identifiers were not retained. Treat those figures as preliminary descriptive evidence. Use the retained JSON artifact above as the reproducible bounded-run record, and retain structured output and revision metadata for future strategy comparisons.

### Shuffled full-match reproducibility run: default configuration (2026-09-28)

Reproduce and retain the harness's exact JSON stdout with:

```sh
npm run --silent verify:bot-strategy:shuffled > output/bot-strategy/shuffled-full-match-2026-09-28.json
```

The run used the harness defaults: three- and four-seat matches; seeds 31–32 and 41–42; seeded shuffled distinct monster, branch, and legal lair assignments; existing bot-selected starting choices and all-bot command policy; a 12-round maximum; and a 2,000-action safety cap. The artifact is exact harness stdout with the npm banner suppressed. It was captured at HEAD `6ec09a93a5caf3d5bbd9217c46f36c55fe698b06`; the worktree was dirty with uncommitted overhaul changes, so this revision does not identify every source byte used by the run.

The JSON was parsed and checked against the default configuration, expected four player-count/seed pairs, per-seat distinct monster/branch/lair assignments, aggregate-versus-match outcome totals, and seat-versus-match action/turn totals. All four matches terminated normally by Monster Challenge after 6, 6, 7, and 6 rounds, with 188, 224, 356, and 342 actions. There were no invalid actions, round caps, or action-safety caps. Winners were Zorb (Air Force, seat 2), Tomanagi (Navy, seat 1), Tomanagi (Marines, seat 3), and Toxicor (Army, seat 1), respectively.

This confirms that the same small shuffled sample remains reproducible and reaches terminal states under the current dirty worktree. Four outcomes do not estimate balance, seat fairness, or tactic quality, and the harness does not validate physical-edition rule fidelity.

An independent read-only review reconciled the retained JSON against the documented configuration, all four match outcomes, winner/seat/branch aggregates, and the stated limitations; no mismatch was found.

## Correctness and strategy follow-ups

- An exploratory paired sample on 2026-09-28 compared two non-rule-changing Challenge heuristics on seeds 0–1 at three and four seats. Spending reserve Infamy when a rival was near defeat kept the four matches terminal in the same rounds but added one action overall (1,232→1,233) and changed some winners. Extending Berserk use to non-Toxicor attackers produced identical winners, victory types, rounds, and action counts across all four pairs. Neither candidate was retained. This small experiment had no saved raw result artifact and is a screening result, not proof that the policies cannot help; rerun with a checked-in raw-output harness, wider seeds, and at least seven paired samples before relying on a strategy comparison.
- `packages/game-engine/src/bots.test.ts` checks route-score values against an independent forward/reverse-distance reference on the transcribed board for two seat/branch scenarios. A synthetic fork fixture verifies that equal shortest alternatives are included and the result is invariant to neighbour enumeration order.
- The cached neighbor index is checked against `movementPathAllowed` for every edge in both board definitions and all four monster movement modes.
- Setup tests cover counter-picking against multiple rivals, independence from seat order, branch selection against the roster, and lair separation from all placed rivals. They establish heuristic properties, not that setup choices improve win rates or balance. One-turn per-seat smoke runs also report zero invalid actions.
- An independent strategy review raised hypotheses around force focus versus movement objectives, choosing only one route through a corridor, and simple Challenge/Encounter/card-value proxies. The route-fork concern has since been addressed in the scorer implementation below; this is a heuristic coverage change, not outcome evidence. Other hypotheses remain unconfirmed. Bounded samples establish that terminal play is reachable, but not strategy quality; use strategy-specific paired outcomes before claiming an improvement.
- An independent counter-review recommends that the next experiment expose an explicit tactic override and compare one focal `force-first` or `research-first` bot against a fixed baseline roster. Rotate the focal seat, monster, branch, lair, and 3/4-seat games. Use match score (win 1, draw 0.5, loss 0) as the primary outcome; treat terminal rate and invalid actions as guardrails, with Challenge conversion, objective value, damage, final Health/Infamy, and turns/actions as diagnostics. Thirty or more balanced assignment blocks are recommended for an initial effect claim; seven pairs are only a screening floor. Current seed/seat/`matchId` tactic hashing can correlate policy with setup, and different action paths can consume different random draws, so matched seeds do not guarantee common random outcomes. The recommendation is an experiment design, not evidence that either tactic is stronger.

### Alternate shortest-route coverage (2026-09-29)

`routeBlockScores` now builds a bounded shortest-path predecessor DAG for each rival monster, capped at the existing 10 movement steps. It scores every hex on any legal shortest route to each unstomped city, Infamy site, or base, so equivalent fork branches do not depend on which neighbour happened to be visited first. The DAG stores predecessor edges rather than enumerating complete paths; predecessor order and reverse traversal are stable. Movement legality and persisted state are unchanged; bot route scores and resulting choices can change. The focused fork test compares the same diamond graph with forward and reversed neighbour order, and the route-score regression compares values against a separately computed forward/reverse-distance reference on two transcribed-board seat/branch fixtures.

A one-off local microbenchmark compared the pre-change single-predecessor scorer from the branch baseline with the DAG scorer. On Node 24.9.0 / Apple M3, 27 2/3/4-seat initial-state actor cases (three seeds per player count), 20 warmup calls per case, and five alternating samples of 1,080 calls each, median runtime was 237.9 ms baseline versus 465.4 ms updated: 220.3 μs versus 430.9 μs per scorer call (1.96×). This measurement has no checked-in benchmark harness or raw artifact, so it is directional. It is not a full-turn or browser profile. Each goal traversal is bounded by the reachable predecessor DAG, while total scorer work can scale with the number of goals; the added cost is measurable, so profile route scoring if it appears on a user-facing critical path. No paired match study was run; competitive effect remains unknown.

### Paired policy screen (2026-09-28)

The bot selector accepts a per-player tactic override for controlled experiments. Omitting the override preserves the existing match-stable inferred tactic; a focused engine test checks that default behavior and pinned tactics can choose different actions. Reproduce the seven-pair, three-round screening run with `npm run --silent verify:bot-policy:paired -- --pair-count=7 --max-rounds=3`. Its exact JSON is retained in [`output/bot-strategy/paired-policy-screen-2026-09-28.json`](../output/bot-strategy/paired-policy-screen-2026-09-28.json). The current harness source is [`scripts/verify-bot-policy-paired.tsx`](../scripts/verify-bot-policy-paired.tsx); the artifact records its SHA-256 and the selector SHA-256.

The pairs clone the same completed legal setup into both treatments, rotate the focal seat across three- and four-player matches, and rotate distinct monsters, branches, and legal lairs. Other seats keep their inferred default tactic within each pair. All seven focal-seat pairs reached the three-round cap in both treatments: 14 incomplete outcomes, zero invalid actions, and zero action-safety caps. The focal bots issued 17 deploys and 21 pass-deploys per treatment; neither treatment issued `draw-research`. Movement and fight actions differed slightly. This sample confirms that the override runs through valid selector paths and that the fixed configuration is reproducible; it produced no terminal win/draw/loss evidence. It provides no strategy-quality, balance, or seat-fairness conclusion.

### Natural Research-draw opportunity diagnostics (2026-09-28)

The paired selector and shuffled full-match harnesses now record Deploy decision invocations, `deploymentChoices` counts (including a histogram by number of legal choices), whether the engine's current Deploy decision permits a Research draw, each existing optional-draw gate, the selected draw path, and whether applying the command emitted `research.drawn`. The selector's diagnostic observer runs only when these simulations request it; it does not influence command selection. For the optional path, an independently recomputed gate conjunction is asserted equal to the selector's actual `shouldDrawResearch` result before a trace is accepted. The controlled Research probe also compares all seven reported gate values against its separately constructed eligible fixture. Empty-deployment fallback draws and priority giant placements are reported as paths where the optional gates are not evaluated. Deploy windows where an earlier selector action returns before the instrumented Deploy branch are counted separately as untraced.

In the retained seven-pair, three-round paired screen, each focal arm had 77 Deploy-window invocations and 479 legal deployment choices across its seven focal matches. In each arm, 21 windows also had a legal `draw-research` command available; 56 windows reached the optional-gate evaluation and 21 used the no-deployment-choices path. Neither arm had an eligible optional draw, a selected draw, an accepted draw, or a rejected draw. The `research-first` focal arm passed the Research-first, Research-deck, unused-deployment, hand-size, and active-screen gates in all 56 evaluations; `objectiveThreatAbsent` and `blockerOpportunityAbsent` each failed in all 56. These counts explain why this sample produced no optional Research draws, but do not establish that either urgency threshold is wrong or that changing it improves play. All 14 matches still reached the three-round cap, so no terminal policy outcomes were observed. Exact per-seat traces and by-tactic aggregates are retained in [`paired-policy-screen-2026-09-28.json`](../output/bot-strategy/paired-policy-screen-2026-09-28.json) (schema version 2).

Run `npm run verify:bot-policy:research-probe` for the deterministic decision-branch probe. Its retained JSON at [`output/bot-strategy/research-draw-probe-2026-09-28.json`](../output/bot-strategy/research-draw-probe-2026-09-28.json) records one identical eligible Deploy state cloned between policies: `research-first` passed every draw gate, selected `draw-research`, and the engine accepted `research.drawn`; `force-first` deployed and consumed the deployment opportunity. The probe checks the action path and starting-state immutability only. It is not an outcome comparison.

### Paired terminal smoke (2026-09-28)

Reproduce the default seven-pair, 12-round-cap screen with:

```sh
npm run --silent verify:bot-policy:paired -- --pair-count=7 --seed-start=3100 --max-rounds=12 > output/bot-strategy/paired-policy-terminal-screen-2026-09-28.json
```

Exact stdout is retained in [`output/bot-strategy/paired-policy-terminal-screen-2026-09-28.json`](../output/bot-strategy/paired-policy-terminal-screen-2026-09-28.json). This schema-version-2 artifact records the run at HEAD `6ec09a93a5caf3d5bbd9217c46f36c55fe698b06`, a dirty worktree with 219 changed paths, selector SHA-256 `47d990c8d099af9d3e0e7d0ad83c248d6d9537068c6181d5a55ee8d7d1a984d7`, harness SHA-256 `0b880e078a97564f40c86f05a388bd6a64d4e51e2291ff6e0b001d16a5fe922d`, and artifact SHA-256 `8deed9f9b7fc370104d8f4813b75aa33f84b3483de7853faef45a6cd6dbb33a0`.

All 14 matches terminated naturally in rounds 5–7, with no invalid actions or safety caps. Focal outcomes were `force-first` 5 wins/2 losses and `research-first` 4 wins/3 losses. Six pairs had the same focal outcome; one favored `force-first`; none favored `research-first`. The focal seat rotated through all three seats in 3-player games and all four in 4-player games. Each pair clones an identical completed legal setup, but the seven roster assignments are not a balanced factorial across monsters and branches. The focal bot issued `draw-research` zero times in both arms, and the full matches issued that action zero times across every seat. This is terminal execution evidence, not a strategy result: there is only one discordant pair; treatment order is fixed (`force-first` first); the tactic override also affects tactic-sensitive behavior beyond Research draws; and command randomness can diverge after the arms take different actions.

The new natural-opportunity diagnostics recorded 164 Deploy-window invocations and 46 legal draw options for the `research-first` focal arm; 118 of those windows reached the optional gate evaluation. None was eligible, selected, or accepted. In all 118 evaluations, the research policy, available deck, unused deployment, hand-size, and active-screen gates passed; `objectiveThreatAbsent` failed all 118 times, while `blockerOpportunityAbsent` failed 115 times and passed 3. The `force-first` focal arm had 166 Deploy windows, 46 legal draw options, and 120 gate evaluations, with zero optional or fallback draw selections. Across every seat in both arms, selected and accepted Research draws were both zero. The controlled deterministic probe shows the eligible selector path and acceptance event work on its constructed state; these terminal matches show that natural play did not satisfy the optional gates in this small rotated sample. They do not establish that relaxing either gate would improve decisions.

Grouped by each seat's actual tactic across the full terminal artifact, `research-first` covered 21 seat-match samples (486 Deploy windows, 142 legal Research-draw options, 344 optional-gate evaluations); `force-first` covered 29 samples (618 windows, 188 legal options, 430 evaluations). Both groups had zero eligible optional-draw windows and zero selected, accepted, or rejected draw commands. The gate counts below are pass/fail counts among optional-gate evaluations; gates are evaluated only on the selector path that reaches the optional decision. The no-deployment-choice path and priority giant-placement path skip these gates.

| Existing selector gate | `research-first` pass / fail (344 evaluations) | `force-first` pass / fail (430 evaluations) |
| --- | ---: | ---: |
| Research deck available | 344 / 0 | 430 / 0 |
| Deployment not started | 142 / 202 | 188 / 242 |
| Research hand below two | 344 / 0 | 430 / 0 |
| Research-first policy | 344 / 0 | 0 / 430 |
| Active military screen | 322 / 22 | 383 / 47 |
| Objective threat absent | 0 / 344 | 0 / 430 |
| Blocker opportunity absent | 3 / 341 | 2 / 428 |

These are descriptive selector-path counts, not independent draws or evidence that either tactic causes better outcomes. The samples mix focal and baseline seats, and the policy override also changes route-block behavior.

The existing treatment is a policy bundle: `force-first` and `research-first` also use different route-block scores, so an outcome difference cannot be attributed to drawing Research. Choose and preregister which question the next study answers. For a whole-policy comparison, retain the bundle and label it explicitly; for a Research-draw-specific comparison, isolate the draw gate while leaving route scoring and every other choice identical. The paired and shuffled harnesses now report natural Deploy windows, gate evaluations, legal draw/deployment options, and selected versus accepted draws. The controlled probe proves one eligible action path; neither is strategy-quality evidence. For a focal-seat outcome, preregister win = 1, draw = 0.5, loss = 0 as the primary paired score, a minimum meaningful effect, and a power-based block count using pilot discordance estimates (alpha .05 and 80–90% power). Thirty pairs are a floor only. Clone each completed setup within a pair, hold focal seat and opponent policies constant, counterbalance player count, seat, monster, branch, and lair across assignment blocks, and randomize execution order. Track seed and RNG state, while acknowledging that paths can consume randomness differently after they diverge. Set a cap high enough to make incomplete matches rare and preregister their handling; retain and report every pair, including incomplete pairs, with cap rates and a sensitivity analysis rather than silently dropping capped pairs. Report wins/draws/losses, invalid actions, caps, draw/deploy opportunities and actions, and game length; these execution metrics are diagnostics, not substitutes for match outcomes.
- Physical-edition rule behavior remains a separate source gate. Do not convert a bot's preference into a rules change.

### Preregistered route-block multiplier comparison (2026-09-28)

Before the outcome run, the controlled selector change and comparison protocol were fixed as follows:

- **Question and intervention:** In an all-`force-first` roster, does setting only the focal bot's route-block multiplier to `0.9` instead of `1.15` change its terminal match score? The other seats remain at the existing `force-first` multiplier of `1.15`. This estimates the effect of the route-score multiplier inside this fixed roster; it does not compare tactic bundles or validate a physical-edition rule.
- **Primary outcome:** Focal match score, with win = 1, draw = 0.5, and loss = 0. The paired estimand is mean score at `0.9` minus mean score at `1.15`. A 0.10 score-point difference was selected as a practical effect threshold before running outcomes. Report 95% paired uncertainty intervals; the study does not authorize a policy change by itself.
- **Pair construction:** Target 30 paired setups, seeds 6200–6229, 12-round match cap, and 2,000-action safety cap. Both arms clone the exact same completed legal setup and start from the same engine seed and RNG cursor. The focal seat and 3/4-seat count rotate through every seat; monster, branch, and legal lair assignments are seeded and rotated. Every seat is explicitly pinned to `force-first` in both arms.
- **Order and censoring:** Execution order is randomized per pair from a separate seeded order list (`20260928`), balanced as evenly as possible between low-first and high-first. Keep every arm and pair in the raw evidence. A pair with an invalid action is an implementation failure; a pair with either match capped before a terminal result is incomplete and excluded from the complete-pair estimate. Also report worst-case score-difference bounds that include every randomized pair.
- **Diagnostics:** Preserve every seat's monster, branch, lair, focal seat, tactics, actions, objective stomps, final Health and Infamy; record match duration in rounds/actions, outcomes, cap/invalid counts, action-command divergence, and per-action RNG cursor traces summarized by first divergence and final cursor. Report arm outcome counts, mean terminal score, paired mean difference, paired t and seeded bootstrap intervals, discordant-pair direction, and composition counts. A matching RNG cursor is not evidence that the same random event was applied after states diverge.

Run and retain exact stdout with:

```sh
npm run --silent verify:bot-route-multiplier:paired -- --pair-count=30 --seed-start=6200 --order-seed=20260928 --max-rounds=12 > output/bot-strategy/route-block-multiplier-paired-2026-09-28.json
```

The dedicated runner is [`scripts/verify-bot-route-multiplier-paired.tsx`](../scripts/verify-bot-route-multiplier-paired.tsx). `routeBlockScores` and `chooseBotCommand` accept an optional per-seat multiplier override; when omitted, the existing tactic-derived values and command selection are unchanged. The engine unit test verifies proportional scores and unchanged reachable route keys under a pinned tactic. The raw artifact will report source hashes, revision/dirty metadata, setup composition, and all pair-level evidence.

### Route-block multiplier result (2026-09-28)

The preregistered command completed all 30 pairs (60 matches) at HEAD `f23a4cd9e722945d20c0f7cbba355013f0d49c5b`. The exact harness stdout is retained in [`output/bot-strategy/route-block-multiplier-paired-2026-09-28.json`](../output/bot-strategy/route-block-multiplier-paired-2026-09-28.json); run it again with the command above. An independent validator and source-provenance capture are retained in [`output/bot-strategy/route-block-multiplier-paired-analysis-2026-09-28.json`](../output/bot-strategy/route-block-multiplier-paired-analysis-2026-09-28.json), reproducible with `node scripts/analyze-bot-route-multiplier.mjs`. The sidecar checks all pair invariants and recomputes the score difference and paired t interval.

All 30 pairs reached terminal outcomes, with no round/action caps or invalid commands. Both arms produced 7 focal wins, 23 losses, and no draws, for a mean terminal score of 0.233. There were four discordant pairs: two favored `0.9` and two favored `1.15`; the other 26 had the same focal score. The mean paired difference (`0.9 − 1.15`) was 0.000, SE 0.0678, approximate paired 95% t interval `[-0.139, 0.139]`, and deterministic paired bootstrap interval `[-0.133, 0.133]`.

The interval includes effects beyond both sides of the preregistered ±0.10 practical threshold. Equal observed win totals therefore do not show that the variants are equivalent or that the multiplier has no meaningful effect. This 30-pair study is inconclusive about the practical threshold; do not change bot policy based on it alone.

Pair setup composition covered 14 three-player and 16 four-player games. The focal seat counts were 9, 9, 8, and 4 for seats 0–3 respectively; the lower seat-3 count reflects that seat 3 exists only in four-player games. Focal monsters appeared 4–7 times each and focal branches 7–8 times each. Execution order was balanced: 15 pairs ran low-first and 15 high-first. Both arms of every pair started with the same seed/RNG cursor, same unique completed setup hash, fixed `force-first` tactics for every seat, and matching per-seat monster/branch/lair roster.

Commands first differed by aligned action index in 24 pairs (median action 64.5); RNG cursors first differed in 17 pairs (median action 115). Cursor agreement before divergence does not prove common random outcomes after different commands. As diagnostics only, mean actions were 277.1 (`0.9`) and 274.1 (`1.15`), mean rounds were 6.37 and 6.33, focal objective stomps totaled 83 and 82, and mean final focal Health/Infamy were 8.0/9.70 and 8.9/9.83. These secondary measures were not preregistered primary outcomes and should not be used to choose a policy.

The raw run artifact hashes `bots.ts` and the harness, records the Git HEAD, and records that the worktree had 22 dirty paths; it does not list those paths or hash every imported engine module. The analysis sidecar therefore additionally hashes every tracked `packages/game-engine/src` file as captured immediately after the run and records the engine files changed from that HEAD. This improves auditability, but the original dirty-path inventory was not captured at run time. The sample estimates the multiplier's total effect in an all-`force-first` roster, not tactic quality, general bot quality, or physical-rule fidelity.

### Controlled Research-draw gate pilot (2026-09-29)

This test isolates the two urgency gates from route scoring and the rest of the tactic bundle. The focal seat stayed `research-first` and every opponent stayed `force-first` in both arms. Control used the normal selector. Treatment bypassed only `objectiveThreatAbsent` and `blockerOpportunityAbsent` on the optional Research-draw path; legal draw availability, deployment timing, hand size, active-screen checks, and command validation remained enforced. No default bot policy or physical rule was changed.

The registered primary outcome was paired focal terminal score (win = 1, draw = 0.5, loss = 0), treatment minus control, with an absolute 0.10 minimum meaningful difference, two-sided alpha .05, and 80% target power. The run targeted 30 pairs from seeds 7200–7229, with a 12-round and 2,000-action cap per match. Both arms used the same completed setup and engine RNG state; arm execution order was randomized from a separate seeded stream and balanced 15 control-first / 15 treatment-first. The 3/4-player and seat rotation covered 14 three-player and 16 four-player pairs, all six focal monsters five times each, each branch 7–8 times, and each lair rank ten times.

Reproduce the run and independent check with:

```sh
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-bot-research-gates-paired.tsx > output/bot-strategy/research-gate-paired-pilot-2026-09-29.json
node scripts/analyze-bot-research-gates-pilot.mjs
```

All 30 pairs reached terminal outcomes, with no invalid actions or capped matches. Control had 10 wins and 20 losses; treatment had 13 wins and 17 losses. The mean paired score difference was +0.100 (sample variance 0.300, SE 0.100), with an approximate paired 95% interval of `[-0.105, 0.305]`. Nine pairs were discordant: six favored treatment and three favored control. The interval includes effects below both sides of the registered ±0.10 threshold, so the pilot is inconclusive and does not support a default-policy change. Based on its noisy pilot variance, approximate paired-t planning estimates 238 complete pairs for 80% power at a 0.10 difference; estimated power at 30 pairs is about 15%. That is only a planning estimate, not a confirmatory sample-size guarantee.

Treatment selected and the engine accepted 90 optional Research draws; control selected none. In control's 466 optional-gate evaluations, `objectiveThreatAbsent` passed 2 times and `blockerOpportunityAbsent` passed 11 times. In treatment's 382 optional-gate evaluations, 90 passed the effective eligibility check and were selected; the other hard gates still had to pass. These are diagnostics from divergent match paths, not independent opportunities or evidence that the extra draws caused the outcome difference.

Commands diverged in all 30 pairs (median first divergence at action 18.5); RNG cursors diverged in all 30 (median action 23). Shared starting seeds and RNG cursors therefore do not imply common random outcomes once the actions differ. The study estimates only the bundled effect of bypassing both urgency gates for this focal-vs-opponent policy mix; it cannot isolate each gate, generalize to other bot rosters, or validate physical-edition rules.

The exact 8.3 MB run output is [`research-gate-paired-pilot-2026-09-29.json`](../output/bot-strategy/research-gate-paired-pilot-2026-09-29.json), with per-pair setups, arm order, outcomes, opportunity/action traces, invalid/cap evidence, and RNG divergence. The recomputing validator writes [`research-gate-paired-pilot-2026-09-29-analysis.json`](../output/bot-strategy/research-gate-paired-pilot-2026-09-29-analysis.json); it now derives pair disposition, arm outcomes, invalid/cap counts, uncertainty, and worst-case bounds from arm evidence rather than trusting the stored pair label or summary. A one-pair fixture confirms that fewer than two complete pairs yields a null confidence interval. The exact harness bytes used by the run are archived at [`research-gate-paired-pilot-harness-at-run-2026-09-29.tsx`](../output/bot-strategy/research-gate-paired-pilot-harness-at-run-2026-09-29.tsx) and match the run-recorded SHA-256. The separate protocol companion [`research-gate-paired-pilot-2026-09-29-preregistration-archive.json`](../output/bot-strategy/research-gate-paired-pilot-2026-09-29-preregistration-archive.json) was exported after the run: the protocol itself was in the hashed harness before execution, but an independent timestamped pre-run JSON copy was not retained. The current harness source differs from the run snapshot only for the post-run small-sample CI behavior and summary cap/invalid diagnostics; the run artifact remains unchanged.

#### Provenance freshness and current-source rerun

The retained raw pilot JSON SHA-256 is `1dd69ebd9adf1211e485cb0006d7b5bc93d0feb4b454436aa524dda2bb6e9695`. It records the dirty-worktree `packages/game-engine/src/bots.ts` SHA-256 `f29a442ea075c7c533c68c18c7718f7991ae0117d07b46f17099a3facf75d49a` at Git HEAD `3bb334433b0799b8e2508dd3704c7c45c388c3ad`. That selector hash matches the committed file at `c4e04ca` (“Audit Research draw gate behavior”). Current `bots.ts` at branch HEAD `a9d607e` hashes to `448d8b667783a498db84d892f2b39e45e1aabd60cc119801e37e5c41aea5298a`; later UI, evidence, and documentation commits did not change it. Commit `20eafef` replaced the single-predecessor route scorer with the shortest-route DAG. Since `blockerOpportunityAbsent` is computed from those route scores, the old pilot does not measure the present selector. The archived at-run harness hash `097a4a3fc6417f032aa902fc51547482aa9a396e9eb28fee326e75d22299e8fd` is verified; current harness source hashes to `c2616979f61a7f6a7010368a0d233717ec9b8d1c44eba3c4df440a1169858929` and contains only the documented post-run small-sample CI and cap/invalid-summary diagnostics. The pilot's 90 accepted treatment draws versus zero in control and +0.100 mean score (95% interval `[-0.105, 0.305]`) are source-specific results, not support for changing the current default policy. It is additionally inconclusive on its preregistered threshold; no gate or rule change is authorized by it.

A fresh 30-pair current-source variance pilot was preregistered with `bots.ts` hash `448d8b667783a498db84d892f2b39e45e1aabd60cc119801e37e5c41aea5298a`, seeds 7300–7329, and a 12-round cap ([preregistration](../output/bot-strategy/research-gate-current-dag-pilot-2026-09-29-preregistration.json)). The attempt was stopped after 2,617 seconds because the runner had produced no output and the machine was needed for online acceptance work. The runner writes its evidence only on completion, so completed-pair count and all outcome data are unavailable ([attempt status](../output/bot-strategy/research-gate-current-dag-pilot-2026-09-29.json)). This is an aborted run, not a pilot result; it supplies no variance estimate, and no policy conclusion follows.

The next strategy-quality study is a newly preregistered, source-pinned rerun on the current DAG scorer: keep the same two-arm question (normal research-first control versus bypass of only `objectiveThreatAbsent` and `blockerOpportunityAbsent`), setup cloning, focal/opponent tactics, score definition, ±0.10 practical threshold, randomized arm order, assignment rotations, RNG-divergence diagnostics, and incomplete-pair handling. The old source's noisy variance estimate suggested approximately **240 complete pairs**, but it cannot size a study of the current selector; the aborted current-source run supplies no estimate. Re-estimate variance with a lower-cost validated design or a more efficient runner before setting the confirmatory sample size. Before execution, preregister the total randomized pair cap and treatment of incomplete pairs; retain every pair and do not replace capped pairs after observing outcomes. Use new non-overlapping seeds, record the exact selector and harness hashes at execution, and do not change the default policy unless the preregistered confirmation supports it. The checked-in runner currently rejects `--pair-count` above 100; before the confirmatory study, extend its validated run/analysis path to support and independently analyze the full target (or add a verified batch-combination path). Do not treat separate uncombined runs as a single study.

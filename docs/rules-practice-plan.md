# Rules practice challenge

## User need

The project owner asked to advance the post-v1 features in `TODO.md`, which includes solo scenarios and rules-learning challenges. The existing home-screen quick rules list the development turn order but do not let a new player practise recalling it.

## First increment: rules practice and guided turn

Provide an optional, browser-local multiple-choice exercise about the documented development turn order, Deploy choice, and source-backed normal-battle retreat rules, plus a playable guided first turn against one bot on the audited board. The scenario uses the ordinary game setup and authoritative engine. Its objective is to complete one turn and return to Player 1; phase guidance describes the current decision without changing legal actions. It does not award account progress or alter match state outside normal game commands. This is practice content, not a statement that the incomplete ruleset is production-ready.

## Privacy and operating cost

Quiz answers and score live only in component memory and are discarded when the page is closed. The guided scenario uses the existing browser-local solo match and bots; it adds no profile progress, analytics, or network request. There is no additional hosting cost beyond the existing static web page.

## Compatibility

The quiz and scenario guide are web-only presentation features. The quiz does not change engine commands, room snapshots, save data, API contracts, or content versions. The scenario starts a normal two-player audited-board match with the existing solo bot; it changes no rules, command, room snapshot, save, or bot contract. Its instructions use only current quick-rules claims: Move → Fight → Encounter → Deploy, with a Research draw as the alternative at Deploy.

## Acceptance boundary

The browser-local quiz and guided first-turn implementation are complete when a player can answer the practice questions, receives immediate explanations and source links, sees a final score, restarts without changing a match, starts the guided match, sees guidance for the phase and completion state, and can continue playing. Additional scenarios, broader source-backed rule coverage, and player testing remain open before the roadmap feature can be marked complete.

## Source-backed retreat practice — 2026-10-10

- Expanded the local quiz from three to six questions. The added prompts cover the no-Encounter retreat boundary, disappearance when no legal retreat exists, and who chooses a forced retreat plus the Research draw that follows. Their wording follows `docs/monsters-menace-america-rules.md`, “Retreating after a normal battle.”
- Added the same retreat summary to the offline player reference with stable section links; `apps/web/public/sw.js` advances its cache name so installed clients refresh the changed reference page.
- `BROWSER_LOCAL_VIEWPORTS=390x844 npm run browser:local:verify` answered all six questions, checked the source link and final 5/6 score, confirmed the practice did not create a match, and completed the guided first-turn scenario. `npm run pwa:verify` passes.
- Human player testing remains open; this is not acceptance of the overall learning flow.

## Movement, city, and Deploy practice — 2026-10-10

- Expanded the browser-local quiz to nine questions with source-linked situations covering movement through a feature without stopping, a `2d` city benefit and Health cap, and choosing Research instead of deployment.
- Added corresponding anchors and concise rule summaries to the offline reference. The service-worker cache version advances so installed clients refresh the updated reference.
- The new wording follows `docs/monsters-menace-america-rules.md`, “Monster movement,” “Stomping” and “City benefit,” and “Military Research instead of deployment.”
- `BROWSER_LOCAL_VIEWPORTS=390x844 npm run browser:local:verify` answered all nine questions, confirmed an 8/9 score and links to the three new rule sections, verified that no match was created, and continued through the guided first-turn scenario. `npm run pwa:verify`, `npm run typecheck:web`, and `npm run docs:verify` pass.
- Player validation of clarity and learning value is still required before closing the roadmap item.

## Monster Challenge practice — 2026-10-10

- Expanded the browser-local quiz to twelve questions with three source-linked situations about who becomes challenger, when surviving giants are challenged, and who wins if a giant defeats the challenger.
- Added the same concise, rulebook-linked summary to the offline reference at `#monster-challenge`; advanced the service-worker cache so installed clients refresh the changed reference.
- `BROWSER_LOCAL_VIEWPORTS=390x844 npm run browser:local:verify` verifies the three answers, source links, 11/12 score, no match creation from practice, and the guided first-turn route; `npm run pwa:verify` and `npm run docs:verify` pass.
- Human playtesting of clarity and learning value remains open.

## Movement-ability practice — 2026-10-11

- Added a thirteenth source-linked question distinguishing Fly, Lake, and Sea movement across water barriers; updated the offline reference with the same concise rule and advanced the service-worker cache to v7.
- The answer follows `docs/monsters-menace-america-rules.md`, “Movement abilities”: Fly ignores water barriers, Lake crosses inland bodies only, and Sea crosses sea spaces.
- `BROWSER_LOCAL_VIEWPORTS=390x844 npm run browser:local:verify` passed on 11 October 2026. Its quiz assertions checked the new answer, reference link, 12/13 score, and no match mutation; its solo assertions confirmed guided first-turn completion. The harness emits console evidence and does not save a standalone report.
- `npm run localization:verify` (2 tests), `npm run pwa:verify`, `npm run docs:verify` (83 Markdown files and local links), and `git diff --check` passed.
- Player validation of clarity and learning value remains open.

## Attack-resolution practice — 2026-10-11

- Expanded the browser-local quiz to fifteen source-linked questions with attack-smash damage and the monster's pre-Challenge target restriction.
- Added an `#attack-resolution` section to the offline reference; advanced the service-worker cache to v8 so installed clients receive the change.
- The questions follow `docs/monsters-menace-america-rules.md`, “Attack resolution” and “Monster attacks.” `npm run localization:verify` and the 390×844 local browser flow verify both answers, reference links, the updated 14/15 score, no match mutation, and completion of the guided first-turn route.
- Human player testing of clarity and learning value remains open.

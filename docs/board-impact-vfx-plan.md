# Board battle impact VFX

**Status:** first local presentation increment implemented; visual acceptance remains open.
**Roadmap source:** `TODO.md`, Milestone 15, richer original animation/VFX.

## User need and scope

The post-v1 backlog asks for richer original visual effects. This increment gives an already-resolved attack hit or destruction a brief visual cue on the target portrait during board battle playback. It is tied to the recorded combat result, so it cannot imply an unaccepted command or choose an outcome. Misses retain their readable result text without a target flash.

## Privacy, operating cost, and compatibility

- No player, account, room, or telemetry data is added.
- The effect uses CSS and existing artwork; it adds no media downloads, external service, or runtime cost beyond a short local animation.
- The cue reads the authoritative attack outcome already supplied to `BoardEventPlayback`. It does not change engine state, command availability, match logs, persistence, projections, or replay data.
- The result label remains visible and accessible when motion is reduced; both system and in-app reduced-motion settings suppress the flash and ring.

## Acceptance

- A hit and a destruction receive distinct target impact classes; a miss receives neither.
- The flash and ring settle to their normal state in a bounded duration.
- System and manual reduced-motion settings remove the animation.
- Human visual review confirms the effect is legible and restrained at supported sizes.

## Implementation record — 2026-10-10

`BoardEventPlayback` maps only `is-hit` and `is-destroyed` results to a target portrait flash and ring. Focused encounter UI assertions cover hit/destruction/miss mapping; `npm run web-motion:verify` checks the finite keyframes and reduced-motion selectors; `npm run typecheck:web` and `npm run web-a11y:verify` pass. Human visual acceptance remains open.

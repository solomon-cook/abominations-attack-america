# Optional synthesized music

**Status:** local implementation and focused preference checks pass; human listening acceptance remains open.
**Roadmap source:** `TODO.md`, Milestone 15, richer original animation, VFX, music, voice, and board themes.

## User need and scope

The existing Play Preferences panel already presents and stores a Music level, but the audio module only plays short event effects. This increment makes that exposed control meaningful with a quiet, original ambient phrase synthesized by Web Audio. It does not add voice, licensed tracks, a new soundtrack asset, or a new settings surface.

## Privacy and operating cost

- No account, room, match, or listening data is collected or sent.
- No media is downloaded and no third-party audio service is used. Playback uses a small number of local oscillator and gain nodes only while enabled.
- Music defaults to zero. It begins only after the player moves the Music control in the current tab; it stops at zero, when muted, or while the page is hidden.

## Compatibility

- Audio remains presentation-only and does not affect commands, deterministic state, persistence, projections, or replay.
- Existing master, music, effects, and mute preferences remain in browser storage. Unsupported or blocked Web Audio degrades to silence.
- Short event effects remain independent of the ambient music volume.

## Acceptance

- Confirm silence on a fresh visit and before moving Music above zero.
- Confirm Music level and master level change the ambient output; zero and Mute all feedback stop it.
- Confirm music pauses while the page is hidden and resumes only after prior explicit opt-in.
- Confirm that browsers without Web Audio and reduced-system audio environments remain usable.
- Human review checks volume balance and that the loop is unobtrusive across desktop and mobile speakers.

## Implementation record — 2026-10-10

`apps/web/src/audio.ts` provides a local sine-wave phrase gated by the existing Music, Master, and Mute controls. A fresh session is silent even when a stored Music value is nonzero until the player adjusts Music in that tab. `npm run audio:verify` passes checks for that default, explicit opt-in, unsupported Web Audio, music/master scaling, mute, page visibility, resume, and zero volume. The full `npm run verify` chain passes, including typechecks, the production build, and Markdown links. Human listening acceptance on desktop and mobile speakers remains open.

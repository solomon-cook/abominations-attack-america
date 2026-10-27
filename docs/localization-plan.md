# Localization plan

**Status:** discovery; no additional locale or translation has been selected.
**Roadmap source:** `TODO.md`, Milestone 15.

## User need and scope

The post-v1 roadmap calls for translated interface and rules content. Localization should let players use the web game and its offline reference in supported languages without changing the authoritative game rules. The owner has authorized post-v1 feature work, but has not selected the first target language or translation reviewer.

The first implementation should establish message catalogs and a locale-selection boundary, then add one reviewed language at a time. Include the home and lobby flows, gameplay controls and results, accessibility labels, help, and the cached offline rules reference. Keep canonical monster, card, branch, board-cell, command, and event identifiers stable; translated display names must not become stored rule data.

## Privacy and operating cost

- Keep locale selection in browser-local preferences for the initial increment. Do not add account fields, telemetry, or a locale service.
- Bundle reviewed catalogs with the static client and offline reference. Do not call a translation API at runtime or send player text to a translation provider.
- Each catalog increases download and cache size. Load non-default catalogs on demand, and report actual bundle/cache impact before adding further languages.
- Human translation, bilingual rules review, and accessible-layout review are required. Machine translation alone is not approval for rule text.

## Compatibility

- Locale is presentation state only; it does not change engine commands, canonical snapshots, room projections, replay exports, deterministic saves, or card/board IDs.
- English remains the fallback for missing catalog keys and the source-language reference for rule wording.
- Format numbers and dates with `Intl` using the selected locale, but preserve game-defined values, dice notation, and canonical coordinates.
- Validate the locale preference as one of the bundled locale IDs; ignore stale or unsupported stored values safely.
- Keep the offline reference and service-worker cache version aligned with translated reference content.

## Decisions before translation work

1. Select the first target language and its regional variant.
2. Name the bilingual reviewer for translated rules and legal instructions.
3. Choose whether locale selection is manual-only or follows the browser language until a manual override is saved. The recommended initial option is browser-language detection with a visible manual selector and a local override.

## Acceptance

- A source catalog covers all player-facing interface, accessible-name, help, and offline-reference strings in the selected scope.
- A verifier rejects missing keys, duplicate keys, malformed interpolation variables, and references to unknown locale IDs.
- The selected language is available through a visible, keyboard-operable control; unsupported and missing translations fall back to English.
- Browser tests cover locale detection/override, reload persistence, offline reference availability, no change to authoritative game data, and supported desktop/mobile layouts including longer translated strings.
- A bilingual reviewer records approval of every translated rules/help section. Do not mark the feature complete based only on catalog coverage or machine checks.

## Operating boundary

This plan does not select a language, approve translated rules, or authorize an external translation service. Those are explicit pre-implementation and release checks; the locale-neutral design and English fallback can be built while the choices are pending.

## First locale infrastructure step — 2026-10-10

- Added a typed English catalog, supported-locale resolver with browser-language fallback, and extracted the rules-practice strings/questions into the catalog (`apps/web/src/localization.ts`, `RulesChallenge.tsx`). This establishes a tested catalog boundary without presenting English-only content as translated.
- `npm run localization:verify` runs the catalog coverage, answer-index, reference-link, and fallback tests and is included in `npm run verify`; `npm run typecheck:web` passes.
- The consolidated `npm run verify` passed on 2026-10-10 with `localization:verify` in its normal chain; the full API/engine suites, typechecks, and production web build also completed. The build retains the existing advisory for a JavaScript chunk above 500 kB.
- The browser language is currently only used to select a supported catalog and set the practice surface's `lang`; manual locale preference, another language, and bilingual rules approval are not implemented.

# Release proof report

This deterministic report separates proof levels. This generator runs board-definition validation only; it does not execute the test suite, static-contract checks, or application builds. It does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Current local/room board initializer | 336-cell board human-audited-north-america@1 passes the engine's structural validation (0 errors); flags do not prove physical-source review | PLAYTEST CANDIDATE; SOURCE APPROVAL BLOCKED |
| Separate provisional-board gate | 336-cell board provisional-authoritative-honeycomb-board@3 passes its explicit provisional gate (0 errors); it is not the current local/room initializer | PROVISIONAL GATE ONLY |
| Full-honeycomb shell | The strict 336-cell candidate has 2538 validation errors | NOT PLAYABLE |
| Engine and API tests | Run `npm test` against the current checkout; deterministic engine/store/property/fuzz/contract coverage | NOT CHECKED BY THIS REPORT |
| Static contracts and build | Run `npm run verify` against the current checkout; API release work also requires `npm run build:api` | NOT CHECKED BY THIS REPORT |
| Dependency security | `npm audit --omit=dev` reports four affected package records across three underlying advisories (two high and one moderate) in the checked-in lock/install; no compatible remediation is committed | BLOCKED |
| Deployed service health | `/health`, `/metrics`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in `docs/first-playable-browser-evidence.md`; generated decorative map background and 336-cell overlay are source/render checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

The current local/room initializer uses the pinned human-audited-north-america@1 board candidate, and every match records its board ID, version, content hash, and ruleset pin. Structural validation and internal transcription flags are not physical-edition verification. Source-faithful promotion and release approval remain blocked until the user's physical edition has been checked, disputed cells and edges are resolved, implementation and fixtures match the recorded evidence, and the required human sign-off is complete. Preserve the existing board identity for saved-match compatibility while that review is pending.

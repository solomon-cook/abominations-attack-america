# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and distinguishes approved board transcription from remaining release sign-offs.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Human-audited MVP board | 336-cell board human-audited-north-america@1 passes strict production validation (0 errors); user-authorized cell-data sign-off is recorded | DATA VERIFIED; RELEASE REVIEW OPEN |
| Unresolved coordinate shell | 336-cell shell remains fail-closed with 2538 validation errors; the separate legacy provisional board gate has 0 errors | ISOLATED FROM NEW MVP MATCHES |
| Remaining source-gated rules | 1 documented source-gated rules group remains in `docs/unresolved-rules-inventory.md` | BLOCKED |
| Engine and API tests | `npm test`; deterministic engine/store/property/fuzz/contract coverage | VERIFY IN CURRENT CHECKOUT |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFY IN CURRENT CHECKOUT |
| Dependency security | No known high-severity production advisories remain; the dependency audit gate must pass before release | NO KNOWN VULNERABILITIES; DEPLOYMENT REVIEW OPEN |
| Deployed service health | Production homepage https://abominations-attack-america.vercel.app returns HTTP 200; served client bundle still contains a localhost API URL; production /api/health returns HTTP 404, /health HTTP 404, and /metrics HTTP 404; Preview dpl_6qTjxUWPxnfNXzVMneooveoNpLeS reports HTTP 200 with prisma persistence and http-polling. Database plan, metered usage, and backup/restore remain unverified | PRODUCTION API/DB RELEASE GATE OPEN |
| Browser QA | 2/2 audited-board browser viewports pass; audited-board online room, shared identity, reconnect, Fight, Encounter, Deploy, and terminal flow pass; full-rules victory, assistive-technology, and manual touch acceptance remain separate | ONLINE SMOKE VERIFIED |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Current release boundary

New MVP room creation pins the human-audited board ID, version, ruleset version, and content hash. The user-authorized board-data sign-off is recorded; independent review, same-scale visual acceptance, durable database persistence, source-gated rules, security, and full release sign-offs remain open. Existing provisional matches retain their immutable pins.

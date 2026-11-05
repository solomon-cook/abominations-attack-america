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
| Deployed service health | Deployment dpl_ELKuRLqyB21KLCjhbVp1SSQ3stqe from commit d35c236ce62de12505480d72c0db65c0f62f3f15 was READY on the canonical alias at 2026-11-05T21:57:00Z; Production homepage https://abominations-attack-america.vercel.app returns HTTP 200; served client bundle has no recorded localhost API URL; production /api/health returns HTTP 200, /health HTTP 404, and /api/metrics returns HTTP 200; Preview dpl_ACKuFhMtrCoy9Lifi4v9eGiNiS3b reports HTTP 200 with prisma persistence and http-polling. Prisma Free at $0.00 with a fixed 200,000 monthly operation cap; workspace meter 24402/200000; Production database-specific meter 3801 operations at 2026-11-05T21:02:30Z; manual restore drill manual dump/restore drill passed once, but Free has no automatic backups or recurring schedule. The latest workspace operation meter is stale. The database-specific count is not a workspace total. | API/DB DEPLOYED; PRODUCTION READINESS GATE OPEN |
| Browser QA | 2/2 audited-board browser viewports pass; audited-board online room, shared identity, reconnect, Fight, Encounter, Deploy, and terminal flow pass; no Production two-browser smoke recorded; full human match, spectator, assistive-technology, and manual touch acceptance remain open | ONLINE SMOKE VERIFIED |
| Production release | Complete human match, spectator acceptance, sustained capacity evidence, routine backup/restore ownership, open rules and board review, accessibility/content/privacy/security sign-offs, rollback rehearsal, and release approvals | BLOCKED |

## Current release boundary

New MVP room creation pins the human-audited board ID, version, ruleset version, and content hash. Production two-browser multiplayer evidence remains open. The user-authorized board-data sign-off is recorded; independent review, hosted restart/soak, shared operation-cap headroom, routine tested backups and restore ownership, complete human match and spectator acceptance, source-gated rules, security/credential rotation, rollback rehearsal, and full release approvals remain open. Production has not been designated production-ready. Existing provisional matches retain their immutable pins.

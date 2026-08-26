# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Provisional board promotion | Immutable 336-cell board provisional-authoritative-honeycomb-board@3 passes the explicit provisional production gate (0 errors) | PROVISIONALLY PROMOTED |
| Source-faithful board audit | Eight documented unresolved source inputs; the strict 336-cell physical-board candidate has 2538 validation errors | BLOCKED |
| Engine and API tests | `npm test`; deterministic engine/store/property/fuzz/contract coverage | VERIFIED LOCALLY |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFIED LOCALLY |
| Dependency security | `npm run security:dependencies:verify` detects exactly three known high-severity Prisma/deepmerge findings, including GHSA-ggr8-5vv4-36mx; no compatible remediation is committed | BLOCKED |
| Deployed service health | `/health`, `/metrics`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in `docs/first-playable-browser-evidence.md`; generated decorative map background and 336-cell overlay are source/render checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

Production room creation may use only the pinned provisional board through the explicit MVP gate; every match records its board ID, version, content hash, and provisional ruleset. Promotion to a source-faithful board remains fail-closed until every board hex, edge, printed feature, water class, and barrier is transcribed from authoritative source evidence, validated, and human-signed.

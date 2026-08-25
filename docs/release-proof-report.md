# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Source and board audit | Eight documented unresolved source inputs; the 254-cell photographed board candidate has 254 production validation errors | BLOCKED |
| Engine and API tests | `npm test`; deterministic engine/store/property/fuzz/contract coverage | VERIFIED LOCALLY |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFIED LOCALLY |
| Deployed service health | `/health`, `/metrics`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in `docs/first-playable-browser-evidence.md`; generated decorative map background and 254-cell overlay are source/render checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

Production room creation must remain fail-closed until every board hex, edge, printed feature, water class, and barrier is transcribed from authoritative source evidence, validated, and human-signed. The current development fixture is not sufficient evidence for first-playable MVP promotion.

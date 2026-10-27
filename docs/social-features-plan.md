# Social features plan

**Status:** post-v1 feature work is active under the owner-confirmed stable v1; local contract and service checks pass, while deployed persistence and private-link acceptance remain open.
**Date:** 2026-10-10

## User need and scope

The project owner has asked to begin work on features previously gated behind the stable-v1 milestone. The first feature in TODO order is to make it easier for account holders to find and play with people they know. Guests must still be able to create, join, and spectate rooms without an account.

The roadmap groups four related capabilities here: friend invitations, private room links, saved opponents, and presence controls. Existing room-code invite links are a basic starting point; this item is not complete until the account-linked relationship and privacy controls are defined and implemented.

## Privacy boundary

- Friend relationships require an explicit, mutual acceptance. Username lookup must not disclose email addresses or account existence through different error messages.
- Presence is opt-in and exposes only a coarse state needed for invitations. It must not reveal a user's current room, opponent list, or activity history.
- Saved opponents are private to the account holder and can be removed at any time.
- Private invitations must be revocable and must not contain account-session credentials. Room membership still uses the existing seat, room-privacy, and authorization checks.
- Account deletion removes relationship and saved-opponent records while retaining only the anonymized match records already covered by the account-deletion policy.
- Blocking and reporting are not included in this feature. They remain a separate prerequisite if public matchmaking is introduced.

## Operating-cost boundary

The intended implementation uses the existing API and relational database, with no separate always-on presence service. Presence is derived from short-lived activity and expires automatically. A prior Render cost scenario is historical only; the owner has since constrained hosting to a free setup or Prisma Postgres. Presence refreshes stay bounded and rate-limited, but the documented 100-tab volume exceeds Prisma Postgres Free's operation quota, so hosted presence remains gated on measurement and an affordable compatible database plan.

### Candidate workload and hosting-cost assumption — 2026-10-10

The current client sends a heartbeat immediately when an enabled account's social summary becomes available, then every 30 seconds while the tab is visible. The server refreshes one `UserAccount.presenceExpiresAt` value; it does not append a heartbeat-history row. A conditional database update caps successful refresh writes to one per account per 15 seconds, so simultaneous requests from multiple tabs or API instances cannot create a heartbeat-write storm. The API also has a global per-source-address limit of 120 requests per minute by default; its `socket.remoteAddress` key must be checked behind the selected reverse proxy before public rollout. This UI normally sends at most two heartbeat requests per minute per continuously visible tab.

| Continuously visible, opted-in tabs | Heartbeat writes per month | Average writes/second | Response-body egress at 33 bytes each |
| ---: | ---: | ---: | ---: |
| 10 | 864,000 | 0.33 | 28.5 MB |
| 100 | 8,640,000 | 3.33 | 285.1 MB |
| 1,000 | 86,400,000 | 33.3 | 2.85 GB |

These are deliberately continuous-activity scenarios: actual tabs are active for less time, but each row refresh is a database write. Egress figures count only the current 33-byte JSON response body; HTTP/TLS overhead and the rest of game traffic are excluded and must be measured against a real service.

The earlier Render price estimate ($13/month per paid API/Postgres environment, $26/month for two) is retained as historical planning data only and is withdrawn by the owner cost constraint. It is not an approved budget, hosting recommendation, or capacity guarantee. Prisma Postgres Free currently allows 200,000 operations/month; the 100 continuously visible tab presence case would write about 8.64 million heartbeats/month before ordinary gameplay queries. Do not enable hosted presence on that free plan without lowering the write rate and measuring all operations against the cap. See the current [`hosting decision record`](hosting-decision-record.md).

The 100-tab case emits approximately 0.285 GB/month of heartbeat JSON bodies. `node --import tsx --test apps/api/src/social.test.ts` verifies the per-account 15-second write guard, and `npm run typecheck:api` passes; these do not establish hosted operation volume or multi-process capacity. The Render estimates above are historical and no longer the selected candidate.

## Compatibility plan

- Additive database migration; do not rewrite room, participant, account-session, or match-history identities.
- Keep guest room flows and existing room-code links working.
- Keep social data outside canonical game state and engine contracts.
- Preserve existing public-profile and match-history behavior; do not make profiles or presence public by default.
- Verify account deletion, session revocation, API authorization, and cross-account isolation after migration.

## Implementation acceptance

Before marking the TODO item complete, cover accepted/rejected/revoked invitations, duplicate and self-invites, privacy defaults, saved-opponent add/remove, presence opt-in/off/expiry, private-link revocation, guest compatibility, account deletion, and authorization isolation. Record the selected hosting cost assumption before enabling the feature in a public environment.

## Implementation progress — 2026-10-10

- Added an additive Prisma migration for friend invitations, accepted friendships, owner-private saved opponents, and opt-in expiring presence (`apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261010100000_social_features/`). Account deletion cascades through the new records.
- Added authenticated social-summary, invitation send/accept/decline/revoke, friend removal, saved-opponent add/remove, presence toggle, and short-lived heartbeat operations in `apps/api/src/accounts.ts` and `apps/api/src/server.ts`.
- Added the account-panel controls. Presence defaults off, is shown only to accepted friends, refreshes only while the tab is visible, and expires after 90 seconds without a heartbeat.
- Added one-use private friend invitation URLs: random tokens are stored as hashes, delivered in the URL fragment rather than the HTTP query, expire after 14 days, can be revoked, and are capped at ten active links per sender. Signed-in recipients must explicitly accept; opening a link alone does not create a friendship. The SPA removes the fragment after acceptance and sends `no-referrer` for page subrequests.
- Focused service tests cover invitation ownership and expiry, reciprocal and duplicate requests, self-invite rejection, non-disclosing unknown-account behavior, private email exclusion, friend-only presence, saved-list isolation, decline/revoke permissions, one-use link acceptance, hashed-token storage, and active-link limits (`apps/api/src/social.test.ts`). API tests and workspace typechecks pass.
- Private room invites still use the existing room-code link in `LobbyPanel`; the new friend-link flow does not change room authorization. The social migration has not been applied to the selected persistent PostgreSQL service. The candidate hosting scenario below is a planning estimate, not provider approval or evidence of service capacity.

## Local verification — 2026-10-10

- `npm run verify` completed its catalogue, source, board, accessibility, API load, persistence-contract, security, documentation, Prisma schema, test, typecheck, and production web-build checks. The API suite passed all 121 tests.
- `npm run docs:verify`, `npm run typecheck`, the production web build, and the targeted `git diff --check` passed. The generated production web assets contain no loopback API URLs.
- After changing link acceptance to an explicit user action, `node --import tsx --test src/social.test.ts` passed all 7 tests; `npm run typecheck:web`, `npm --workspace @abominations/web run build`, `npm run account-privacy:browser:verify`, `npm run docs:verify`, and targeted `git diff --check` passed. The mobile browser check confirms that opening the fragment link makes no acceptance request, the user confirmation triggers exactly one request, and the consumed fragment is removed. The build still reports the existing >500 KB JavaScript chunk warning; generated assets contain no loopback API URLs.
- All project SQL migrations were applied to a fresh disposable PGlite database, and the Prisma-backed API route probe passed mutual invitation acceptance, private saved-opponent storage, friend-only opt-in presence, owner access to stats after opting out, hidden-profile 404, public-profile visibility, and guest public-room create/join/spectate. That probe exposed and fixed the hidden-profile status mapping in `apps/api/src/server.ts`. PGlite confirms local PostgreSQL-protocol persistence behavior; it is not evidence of managed PostgreSQL concurrency, deployment restart, or hosting capacity.
- Added `npm run account-routes:postgres:verify` as a repeatable disposable-database check. On the fresh PGlite database it passed authentication enforcement, public-stats defaults, profile visibility and owner-stat access, concurrent invite acceptance (exactly one request succeeds), private saved-opponent isolation, friend presence opt-in/off, social/stat account-deletion cascades, anonymized retained match history, and guest public-room create/join/spectate. It uses sequential Prisma clients because the in-memory PGlite socket database is a local protocol harness, not a managed multi-instance PostgreSQL service.
- On 11 October 2026, `POSTGRES_BIN_DIR=... npm run persistence:postgres:local:verify` reran the account/social route suite against a fresh temporary PostgreSQL 17 server, alongside the room-restart/idempotency, persistent-error-aggregate, and 2-/3-/4-player victory-route checks. The account/social checks passed, including exactly one successful concurrent invite acceptance, private-stat and saved-opponent isolation, account-deletion cascades, anonymized retained history, and guest create/join/spectate. This strengthens local PostgreSQL evidence but does not apply migrations to an owner-selected managed service or prove multi-process, deployed restart, capacity, or human privacy acceptance.
- An ignored local `apps/api/.env` contains a non-loopback PostgreSQL URL. A read-only Prisma migration-status probe reached it on 2026-10-10 and found 13 migrations, 12 pending. Its environment and owner-approved role are not recorded, so the social migration was not applied. Managed-service migration, concurrency, deployment restart, complete guest-flow UX, and human privacy review remain open. Hosting is constrained to a free setup or Prisma Postgres; the prior Render cost scenario is withdrawn, and expected scale/query volume still needs measurement.

## Open owner decision

The historical Render cost scenario is not current approval. Provider selection, expected scale, actual staging measurements, and fit within the free/Prisma Postgres constraint remain open. Keep hosted enablement gated until those decisions are recorded; this does not block local implementation or verification.

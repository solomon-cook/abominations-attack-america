# Convex migration runbook

The Convex schema retains each legacy database ID as `externalId`; relationship fields continue to use those legacy IDs. This preserves room codes, participant IDs, event history, account links, password hashes, and SHA-256 session/token hashes. Existing verified accounts can keep signing in with their existing cookie after import.

## Export

Run `npm run convex:export-migration` from the repository root with the intended PostgreSQL source configured as `DIRECT_URL` (preferred), `DATABASE_URL`, `PRISMA_DATABASE_URL`, `DATABASE_URL_POOLED`, or `POSTGRES_URL` (the script also loads `apps/api/.env`). When both direct and pooled URLs exist, it uses `DIRECT_URL` for the repeatable-read snapshot. It writes private JSONL files under the ignored `.data/` directory. The manifest records table counts, file sizes, and SHA-256 checksums. JSONL is sensitive: the files include password hashes, session hashes, email addresses, and game histories. Keep the directory local and remove it after verified migration and rollback retention ends.

The export omits WebSocket tickets because they are short lived and are not part of Convex's subscription path; clients reconnect through Convex subscriptions after cutover. It also omits HTTP rate-limit buckets, which are ephemeral. Every other persistent table from the current Prisma schema is included, including room receipts, account tokens/sessions, friendships, saved opponents, replay events, match results, and error aggregates. The Convex HTTP adapter applies the existing 120-request-per-minute per-address limit and periodically deletes expired hashed-address buckets.

## Import into an empty development deployment

This workspace now has the Convex project `abominations-attack-america` and a newly provisioned US East development deployment. The Convex CLI configuration and URLs are in the ignored root `.env.local`; do not commit or share that file. `npx convex dev` syncs backend changes and regenerates `convex/_generated`. The web Vite config reads the root CLI URLs in development and maps them to the client variables, so `npm run dev` connects realtime subscriptions and proxies `/api` to the same development deployment. Production builds use explicit `VITE_CONVEX_URL` configuration and never fall back to the development URL.

For Vercel, set `VITE_CONVEX_URL` as a build variable so the client uses live Convex subscriptions. Set `CONVEX_SITE_URL` as a server runtime variable for the same-origin `/api` proxy, plus `WEB_APP_ORIGINS`, `WEB_APP_URL`, and the account email delivery settings. Set `APP_ENV=production` in the Convex production deployment so registration never returns development verification links and missing email delivery fails closed. Use `APP_ENV=development` only in a development deployment. Leave `VITE_API_URL` empty for a Convex build; the client forces API calls through same-origin `/api` whenever Convex realtime is enabled, preserving the `aaa_account` cookie.

The exporter writes `import-commands.sh`. Set `CONVEX_DEPLOYMENT` to the empty development deployment and run that script. It accepts only `dev`, `dev:*`, or `local` deployment references, and does not use `--replace`; use a fresh empty target if an import is interrupted. Convex JSONL import is currently a beta CLI feature and rejects documents above 1 MiB. The exporter checks this limit before writing.

After import, compare every table count to `manifest.json` and run the account, room, privacy, command retry, bot takeover, replay redaction, and multiplayer reconnect checks against the deployed Convex URL. Specifically verify login using an account that existed before export and room access using a pre-export room token. Do not cut over until these checks pass.

## Production cutover gates

The production import command is intentionally not generated. Before production import, provision and verify the exact Convex project/deployment and Vercel environment variables, agree on a maintenance window, stop source writes, take a final consistent export, and repeat the import/readback checks against that exact deployment. Preserve the source database backup and a tested rollback route. Then deploy the Convex functions and same-origin Vercel proxy together, verify the live health endpoint and a real two-browser match, and retain the old API route until the acceptance window is complete. Do not run the generated development import script against production.

Relevant CLI details: [Convex data import](https://docs.convex.dev/database/import-export/import) and [Convex `import` command](https://docs.convex.dev/cli/reference/import).

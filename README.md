# Abominations Attack America

A cross-device digital board-game project inspired by *Monsters Menace America*.

## Workspace

- `apps/web` — first playable browser build
- `apps/ios` — reserved native iPhone/iPad client
- `apps/tvos` — reserved Apple TV client
- `apps/desktop` — reserved desktop client
- `packages/game-engine` — platform-independent game state and rules
- `packages/shared` — shared room projections, account/stat shapes, and WebSocket protocol contracts
- `docs` — source notes and product planning

For the runtime map, local development workflow, and validation commands, see
the [developer guide](docs/development.md).

The web prototype supports local play, guest online rooms, account-linked online matches, public profiles, and a no-login spectator mode. Account emails and password hashes stay server-side; rooms and public rankings expose generated usernames only. The API uses the same game engine and exposes short-ticket WebSockets with polling fallback.

## Run the web prototype

```bash
npm ci
npm run dev
```

Run the room API in a second terminal:

```bash
npm run dev:api
```

Without `DATABASE_URL`, the API uses an in-memory store for local testing and account endpoints are unavailable. Accounts and durable match recovery require Prisma/Postgres. Copy `.env.example` to `apps/api/.env`, configure the database and allowed web origin, then apply the migration:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

For email verification and password reset, configure `ACCOUNT_EMAIL_DELIVERY_URL` (a JSON delivery endpoint accepting `{to, subject, text}`), its optional bearer token, and `WEB_APP_URL`. Development returns one-time links in the account UI instead of requiring a mail sender. Never commit `.env` or database credentials. The web client defaults to `http://localhost:8787`; set `VITE_API_URL` when the API is deployed elsewhere.

## Accounts and resumable matches

Guests can create or join rooms without an account. Verified accounts receive a generated public username, can link only the current seat, and can resume that match from the account panel on another device. A disconnected seat remains available to its owner for four minutes; after that, the server bot takes decisions until the next connection reclaims the seat. Bot actions remain in the event history and mark the completed result as bot-assisted.

Profiles and category leaderboards include completed online matches only. Test-fixture rooms are excluded. The win-rate board requires five completed matches and the luck board requires 20 recorded dice rolls. Account deletion removes the account's stats and anonymizes its seats in shared room history.

## Source material

The physical edition of *Monsters Menace America* is authoritative for the rules model. Source-dependent transcriptions and rules behavior remain provisional pending review against that edition; a third-party scan is reference material only. Physical-source review and sign-off are manual release gates. See the [rules source status](docs/rules-source.md). This project is an original digital implementation and does not include the original board, illustrations, or card assets.

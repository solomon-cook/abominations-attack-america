# Abominations Attack America

A cross-device digital board-game project inspired by *Monsters Menace America*.

## Workspace

- `apps/web` — first playable browser build
- `apps/ios` — reserved native iPhone/iPad client
- `apps/tvos` — reserved Apple TV client
- `apps/desktop` — reserved desktop client
- `packages/game-engine` — platform-independent game state and rules
- `packages/shared` — shared domain types and future protocol contracts
- `docs` — source notes and product planning

The web prototype supports local play, online rooms, browser-session restoration, and a no-login spectator mode. The API uses the same game engine and exposes WebSockets with polling fallback.

## Run the web prototype

```bash
npm install
npm run dev
```

Run the room API in a second terminal:

```bash
npm run dev:api
```

Without `DATABASE_URL`, the API uses an in-memory store for local testing. To use the existing Prisma Postgres database, copy `apps/api/.env.example` to `apps/api/.env`, add the connection URL, generate the client, and apply the schema:

```bash
npm run prisma:generate
npm run prisma:push
```

Never commit `.env` or database credentials. The web client defaults to `http://localhost:8787`; set `VITE_API_URL` when the API is deployed elsewhere.

## Source material

The attached rulebook is treated as reference material for the rules model. This project is an original digital implementation and does not include the original board, illustrations, or card assets.

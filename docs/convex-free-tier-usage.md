# Convex usage and real-time design

## Production state

As of 2026-11-18, production is using Convex deployment `careful-ibis-752`. Vercel serves the app from commit `037610a`; the matching Convex functions and schema from that commit have also been deployed to `careful-ibis-752`. Ordinary local singleplayer uses in-browser state and makes no Convex request. The app does not restore a saved online room on startup, and the account panel and public-room browser only request data when opened. Explicit multiplayer, account, replay, and TV-viewing links still use their requested online features.

## Keep multiplayer reactive

The browser uses Convex's live query connection for multiplayer room updates. It does not poll the database or maintain a second game-state WebSocket service. `rooms.readLiveState` subscribes each participant to the current room state; Convex reruns it when that room changes and pushes the update. `rooms.readParticipants` is a separate, low-churn subscription, so a game move does not make every client reread participant and username rows. It is bounded to the four player seats and the requesting spectator when needed.

Room state is gzip-compressed when stored, then expanded and projected in the query. A local four-player opening snapshot measured 10.7 KB before compression and 2.3 KB after. The replay start state is stored separately so a move does not rewrite it. Live room queries do not read replay event rows: moves write the current room state and one replay event, while replay history is loaded only when a replay is requested. The room snapshot retains a short event and text-log window for immediate UI feedback; after a long disconnect or a burst of more actions than that window, the current authoritative state can restore the board while some older animations are skipped.

## Remaining Convex work

- Creating or joining a room uses a mutation; accepted moves and setup choices use mutations that update the room and append replay data.
- A connected player holds one room-state subscription and one participant subscription. The state query reruns when the room state changes; the participant query reruns when its participant or linked username data changes.
- Active room clients send a heartbeat every five minutes to a separate presence record. Heartbeats stop when the match completes. Room-scoped scheduled checks detect missed heartbeats, handle bot takeover, and clean up abandoned rooms.
- Account dashboard, leaderboard, public-room search, and replay work happens only when a player opens those features. The account dashboard is fetched in one request, and the leaderboard is fetched only when its section is opened.

These reads and writes are intentional for persisted multiplayer state, presence, accounts, and replay. Database I/O still grows with room size, state size, connected players, and match duration. The Free allowance therefore cannot be guaranteed for every usage pattern just by removing unnecessary calls.

## Usage evidence and limits

On 2026-11-18, the Convex usage command reported 11,206 function calls and 3.044069 GB of database I/O month-to-date for `careful-ibis-752`; data egress was 0.001389 GB. The published Free allowance is 1 million function calls and 1 GB of database I/O per month. Call volume was well below its allowance, while database I/O was already above its allowance. No usage limits were configured. See [Convex limits](https://docs.convex.dev/production/state/limits).

That month-to-date number includes traffic from before the updated app and Convex functions were deployed, so it cannot show whether the new design has reduced usage yet. At the time of the reading, today's meter showed 8 calls and about 11.9 KB of database I/O, which is too little and too quiet to represent a multiplayer session. Convex's recent insights still contained a few retries from the previous global stale-participant worker; the deployed source replaces that worker with room-scoped scheduled checks. There is not enough per-function history to attribute the earlier 3 GB to a representative game session.

For a meaningful comparison, record the deployment's daily database-I/O meter, play a representative multiplayer match with multiple connected clients, and compare the next day's reading. Keep the Free allowance and expected player count in view; reactive subscriptions avoid polling but each connected client's query must still be recomputed when the room state changes.

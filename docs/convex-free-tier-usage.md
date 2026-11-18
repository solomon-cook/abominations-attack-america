# Convex usage and singleplayer

Singleplayer game state and bot turns run in the browser. The previous production build still contacted Convex when a game screen mounted: it automatically read a saved online room, and the closed account panel queried the current account and public leaderboard. Signed-in players could trigger four more account reads. This patch makes saved-room recovery explicit and waits until the account panel opens before requesting account or leaderboard data.

Online rooms remain reactive through Convex subscriptions. Accepted multiplayer actions still write authoritative room state and replay history, and connected clients receive updates as soon as those writes are accepted. Presence writes are background traffic and do not carry game decisions.

The production deployment was measured on 2026-11-18 at 11,198 function calls and 3.044 GB of database I/O month to date. The published Free allowance is 1 GB of database I/O per month. Retained logs were not sufficient to attribute that total to particular features, so this reading does not establish how much came from singleplayer startup or multiplayer. Eliminating accidental singleplayer reads prevents that traffic going forward, but does not by itself guarantee that multiplayer fits within the Free allowance. Recheck Convex usage after the fix reaches production and after representative multiplayer play.

# Privacy information — development playtest

The current playtest supports guest room access and does not require an authenticated profile. A room stores the display name supplied for the session, a random participant token (stored hashed by the server), room presence, commands, events, and the match snapshot needed to reconnect.

The client stores its session token and preferences in browser storage so the same tab can reconnect. Clear site storage or use **Leave room** to remove the local session. Do not share a room token.

Spectators receive a projection that excludes player hands and authoritative deck order. Tokens are excluded from structured logs and error responses. The current repository has no analytics, advertising, profile system, or configured production data-retention policy.

Before public release, the project still needs a reviewed privacy notice, retention/deletion policy, deployed transport/security review, and an operator contact route.

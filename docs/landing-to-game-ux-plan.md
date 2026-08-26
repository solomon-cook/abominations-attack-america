# Landing Screen to Game UX Plan

## Purpose

Simplify the journey from opening **Abominations Attack America** to taking the first action in a match. The desired feeling is a complete-screen strategy game: a strong title/menu surface, a short pre-game setup sequence, then a map-first game screen where the board is the dominant object and supporting information appears when it is needed.

This is a UX and presentation plan. It preserves the existing local playtest, provisional-board playtest, victory scenario, board review, online create/join/spectate, setup choices, settings, accessibility preferences, reconnect behaviour, spectator restrictions, and game actions. It does not promote provisional board data to authoritative production data.

## Audit summary

### Current journey

1. The landing screen shows a hero, five action buttons, the online lobby, and optional quick rules in one vertical surface.
2. The primary actions currently mix player-facing play with development and review tools:
   - `Start local playtest`
   - `Play honeycomb board`
   - `Victory test`
   - `Review full board`
   - `Rules`
3. Online play is exposed directly beside the hero rather than being a deliberate mode in the game menu.
4. Starting local play immediately enters the game shell, while online play enters a lobby/setup state. The user therefore experiences two different journeys from the same landing screen.
5. The game shell includes a title, development label, board status, turn progress, onboarding, map controls, action dock, optional side panel, settings, and several development notices. These are useful, but they compete for attention before the player understands the current decision.
6. Setup is functionally present in `SetupPanel`, but it is visually part of the game page rather than a clear pre-game “Create / Configure / Ready / Start” menu step.
7. The game already has important foundations for the desired direction: full-screen layout CSS, a board-first layout, a collapsible details panel, `TurnProgress`, `ActionDock`, `SettingsPanel`, and a full-screen Monster Challenge overlay.

### Main UX issues

| Issue | User impact | Recommended treatment |
| --- | --- | --- |
| Too many equally prominent landing actions | New players cannot tell what the normal path is | Make one primary `Play` route; move development/review tools into `More / Development` |
| Online lobby is visually attached to the landing page | Multiplayer feels like a form rather than a game mode | Put `Online` behind the Play menu and give create/join/spectate a shared lobby screen |
| Local play skips a meaningful pre-game menu | The game appears to start abruptly and defaults are hard to understand | Add a lightweight local game setup screen with a clear `Start match` action |
| Development language is visible at the top of play | Players feel they are using a test harness rather than entering a game | Keep source/provisional warnings, but move them into a compact status drawer or pre-game warning |
| Information is split between many panels | Players must scan the whole page to find the current decision | Keep the board central; use one contextual action panel and optional drawers |
| Settings and help are peer actions beside play controls | Important and occasional actions have equal visual weight | Put them in a consistent top-right menu with keyboard/focus support |
| The first action is not always obvious | Players may read the board before understanding what they can do | Use one prominent current-turn prompt plus board highlights and a single next-action control |

## Reference patterns to borrow

### Digital Risk / RISK: Global Domination

Use the digital Risk pattern as a reference for a focused strategy-game funnel, not for visual copying:

- A clear main menu separates normal play from multiplayer, options, tutorial, and other destinations.
- Lobby and ready-up are treated as one destination, with game settings and map context visible before starting.
- Match setup is a deliberate configuration step, not an accidental by-product of the landing page.
- During play, the map remains the primary surface and actions are tied to the selected territory/unit and current turn.
- Post-game and surrender/exit flows are explicit, so leaving a match does not feel like a browser navigation accident.

The current Risk lobby/map overhaul announcement is especially relevant to this project because it describes a lobby with ready-up, map preview, map information, and detailed settings in one coherent flow: [RISK: Global Domination lobby and map-select overhaul](https://store.steampowered.com/news/posts/?appgroupname=RISK%3A+Global+Domination&appids=1128810&enddate=1773798481).

### Civilization VI

Use Civilization VI as the stronger reference for the in-match shell:

- The main map is where the player spends most of the time; the UI frames it rather than replacing it.
- A persistent top information strip gives at-a-glance state and access to menus.
- The active unit/decision gets a focused action area, while encyclopedic information is opened on demand.
- A minimap/overview and map navigation controls support orientation without taking over the main map.
- Main menu, single-player, multiplayer, create-game, tutorial, options, and resume/load are distinct steps.

The official manual describes the main screen as the place for moving units and engaging in combat, with an information bar for key resources and access to the Civilopedia and game menu: [Civilization VI official manual — interface](https://cdn.steamstatic.com/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf). The same manual documents the separated main menu and create-game flow: [Civilization VI official manual — menus and create game](https://shared.steamstatic.com/store_item_assets/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf?t=1740607040).

## Proposed journey

```text
Title / Main Menu
        |
        +--> Play
        |      +--> Local game --> Game setup --> Match intro --> Game
        |      +--> Online game --> Create / Join / Spectate lobby --> Ready / Setup --> Game
        |      +--> Resume / Reconnect (when a recoverable match exists)
        |
        +--> How to play
        +--> Settings
        +--> Development tools
               +--> Provisional board playtest
               +--> Victory scenario
               +--> Full board review
```

### 1. Main menu / landing screen

Replace the current mixed landing surface with a full-viewport menu screen:

- Retain the existing hero artwork and title treatment.
- Make `Play` the single primary button.
- Add a secondary `How to play` button.
- Add a compact `Settings` button.
- Show `Resume match` only when a resumable local or online session exists.
- Put `Development tools` behind a secondary menu or drawer. Preserve all four current development/review actions, but label them as development tools and retain their warnings.
- Do not show the complete online lobby form on the landing screen.
- If a room code is present in the URL, make `Play online` the highlighted destination and prefill the code as it does today.

Suggested menu labels:

```text
PLAY
HOW TO PLAY
SETTINGS
MORE
```

`More` contains `Development tools`, `Credits`, and any future non-play destinations. This keeps the authored game identity in front of the player without hiding functionality from testers.

### 2. Play menu

Open `Play` as a full-screen menu or centered modal with three clear cards:

- `Local game` — play on this device; no account or room required.
- `Online game` — create or join a room; retain public/private rooms, invite links, ready state, and spectator mode.
- `Resume match` — only shown when applicable.

Each card should have one sentence explaining the mode and one obvious action. Do not expose player count, privacy, or display-name controls until `Online game` is selected.

### 3. Local game setup

Give local play the same menu rhythm as online play, without adding unnecessary configuration:

1. `Game mode`: default development playtest; development-only variants remain available from `More`.
2. `Players`: retain 2–4 players.
3. `Assignments`: present monster, branch, lair, and starting-choice selection through the existing setup rules.
4. `Review`: show a compact summary of selected players and board/ruleset status.
5. `Start match`: one final confirmation that transitions to the game.

For the default local path, provide a `Quick start` shortcut that uses the current valid defaults and goes straight to the match intro. The full setup remains available for testing and real player choice.

### 4. Online lobby

Refactor the existing `LobbyPanel` into a dedicated online lobby screen, retaining its API and server behaviour:

- Header: `Online game`, room code, connection state, and `Leave lobby`.
- First choice: `Create room`, `Join room`, or `Spectate`.
- Create state: display name, player count, privacy, and invite link.
- Waiting state: player seats, participant names, readiness, and a single `Ready` control.
- Setup state: reuse `SetupPanel`, but show it as a wizard step with `Back`, `Continue`, and a visible progress indicator.
- Start gate: clearly state why the match cannot begin if seats are incomplete or players are not ready.

The lobby should feel like a game pre-screen, not a form embedded under marketing copy. Preserve token-free room links, no-account access, spectator restrictions, reconnect state, and public-room discovery.

### 5. Match intro / handoff

Before the first playable board appears, use a short match-intro state (or a non-blocking transition panel):

- Show player/monster identity, branch, starting lair, and board/ruleset name.
- Show the turn sequence: `Move → Fight → Encounter → Deploy`.
- Show one button: `Enter the map`.
- Keep provisional/development warnings visible here, where they are useful, rather than dominating every gameplay frame.

For a fast rematch, allow this intro to be skipped after the first completed match.

## Proposed in-game shell

### Persistent frame

Borrow the Civilization VI information-bar idea without reproducing its density:

- Top-left: game title or compact logo and current room/match identifier.
- Top-centre: current player and phase, e.g. `Player 1 · Move`.
- Top-right: `Menu`, `How to play`, `Settings`, and connection status.
- Main area: the board should occupy most of the screen.
- Bottom or side action area: one contextual prompt and the legal actions for the active phase.

Remove the repeated marketing headline from the game shell. Keep game identity, not landing-page copy.

### Information hierarchy

Keep these visible without opening a drawer:

- Current player/monster.
- Current phase and turn progress.
- Health/infamy and the active objective.
- The one action the player can take now.
- Board pieces, legal destinations, selected path, and outcome feedback.

Move these behind `Details`, `Cards`, `Units`, `Rules`, or `Log` drawers:

- Full monster record.
- Board reference material and source/provisional explanation.
- Unit inventory and stack inspection.
- Revealed cards and detailed card rules.
- Long event log and historical combat results.

This preserves the existing components while reducing simultaneous visual competition. `gamePanelOpen` can become a tabbed or drawer-based details surface rather than a general-purpose side rail.

### Contextual action model

The active phase should control the action area:

- `Move`: prompt the player to select a monster/unit and destination; show `Confirm move` only after a path is selected.
- `Fight`: show the target and a single next resolution action; expose dice/results in the focused combat panel.
- `Encounter`: show the encounter decision and available choices.
- `Deploy`: show available deployment choices or `Draw research`.
- `Challenge`: use the existing full-screen duel treatment.
- `Game over`: use a dedicated result screen with `Rematch`, `Return to menu`, and `View game log`.

Do not remove the existing action components. Change when and where they appear so the current decision is obvious.

## Implementation phases

### Phase 1 — Information architecture

- Add an explicit app navigation state for `menu`, `play-choice`, `local-setup`, `online-lobby`, `match-intro`, and `game`.
- Preserve URL room-code prefilling and existing reset/start handlers.
- Move development-only actions behind `Development tools`.
- Add a safe `Return to menu` path that does not destroy an online room or lose reconnect state without confirmation.

### Phase 2 — Landing and lobby surfaces

- Redesign `HomeScreen` as the full-screen main menu.
- Split `LobbyPanel` into a menu entry and dedicated lobby states, or introduce a wrapper while keeping its callbacks and server contracts.
- Reuse existing `SetupPanel` inside a setup wizard.
- Add `Resume match` only when state restoration is available.

### Phase 3 — Gameplay shell

- Retain the current board and board interaction logic.
- Simplify the game header and move settings/help/menu into a single consistent menu.
- Turn the details rail into explicit tabs/drawers.
- Keep the board-first layout and current full-screen Challenge overlay.
- Consolidate development notices into the match intro and a compact status affordance.

### Phase 4 — Validation and polish

- Test the complete local path, online create/join path, spectate path, URL invite path, reconnect path, and terminal/rematch path.
- Re-run existing accessibility, responsive, keyboard, browser, and board-layout checks.
- Add browser assertions for the menu state, one-primary-action rule, setup progression, and return-to-menu safety.
- Manually review 1280×720, tablet portrait, and 390×844. Confirm that the board remains usable, the current action is visible, and no critical control is hidden behind a drawer.

## Acceptance criteria

- A new player can identify the normal path within five seconds of landing.
- The landing screen has one primary play action; development tools are discoverable but secondary.
- Local and online play use the same conceptual sequence: choose mode → configure → review/ready → enter map.
- Existing local, online, spectator, setup, settings, accessibility, board-review, provisional, and victory-test functionality remains reachable.
- The game screen opens as a full-screen map-first surface with no landing-page marketing copy.
- The current phase and next legal action are identifiable without opening a secondary panel.
- Secondary information can be opened on demand without replacing or permanently shrinking the board.
- Leaving, reconnecting, spectating, and reaching game-over remain explicit and safe.
- Provisional/development status remains truthful and visible at the appropriate pre-game or details level.
- Automated checks continue to distinguish UI/build proof from physical-board fidelity, source sign-off, live deployment, and manual visual acceptance.

## Out of scope

- Changing game rules, board coordinates, engine authority, persistence, room permissions, or server contracts.
- Removing local playtest, provisional-board playtest, victory scenario, board review, spectator mode, or settings.
- Replacing the current art direction with copied Risk or Civilization VI assets.
- Treating Digital Risk or Civilization VI as exact visual specifications; they are interaction and information-hierarchy references only.


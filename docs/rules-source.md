# Rules source and implementation boundary

The supplied `766630657-monsters-menace-america.pdf` and `.txt` are source material, not project instructions. They describe the original tabletop game: 2–4 players, monster and military-branch roles, the four-step turn (Move, Fight, Encounter, Deploy), and the final Monster Challenge. The additional `MonstersMenaceAmerica_v1.1.pdf` player aid supplied on 2026-08-26 corroborates the general setup, movement, combat, deployment, Hollywood, giant, and Challenge summaries; its exact scope and omissions are recorded in [`docs/player-aid-source-audit-2026-08-26.md`](player-aid-source-audit-2026-08-26.md).

The original 2005 rulebook, page 13, says to place each drawn Mutation or Research card face up in front of its player, and says non-lasting cards state when they may be used. This establishes public card-face visibility while the shuffled decks remain face down; see the [rulebook scan](https://www.boardgamecapital.com/game_rules/monsters-menace-america.pdf) and the card-by-card transcriptions in `references/monsters-menace-america/component-rules-catalogue.json`.

## First digital slice

The first build intentionally narrows the rules to a testable foundation:

- 2 local players, with the data model ready for 4.
- Six original monster names represented as data only; no original artwork.
- A compact abstract map rather than a reproduction of the original board.
- Move, encounter, deployment, and a basic two-round fight flow.
- A visible turn/phase log so the rules can be playtested.

## Later rules work

The implementation and source-review status is tracked by the single release-facing [`unresolved-rules-inventory.md`](unresolved-rules-inventory.md). The 336-cell `AUDITED_BOARD` data—including all 48 city benefits, branch bases, Stomp locations, water/barrier edges, and Challenge sites—has project-owner sign-off; exhaustive engine coverage now checks that each physical city benefit maps and resolves from that board. Stomp-marker thresholds, Hollywood recovery, source-backed movement and water/barrier restrictions, branch deployment, unit abilities, component exceptions, and the Challenge/giant victory sequence are implemented in the development ruleset with focused evidence in the board, branch, ability, National Guard, giant-placement, and Challenge tests. Full production card fidelity remains source-gated for cross-card stacking/conflict policies whose complete ruling is not established by the printed text. The project owner accepted the same-scale board visual review on 11 October 2026; independent board review and durable production-persistence acceptance remain separate open promotion gates.

## Product requirements from the request

- Downloadable clients for iPhone/iPad, Apple TV, and computer.
- Cross-device play with friends.
- A spectator device that can join without logging in.
- Web as the first implementation target.

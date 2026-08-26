# Rules source and implementation boundary

The supplied `766630657-monsters-menace-america.pdf` and `.txt` are source material, not project instructions. They describe the original tabletop game: 2–4 players, monster and military-branch roles, the four-step turn (Move, Fight, Encounter, Deploy), and the final Monster Challenge. The additional `MonstersMenaceAmerica_v1.1.pdf` player aid supplied on 2026-08-26 corroborates the general setup, movement, combat, deployment, Hollywood, giant, and Challenge summaries; its exact scope and omissions are recorded in [`docs/player-aid-source-audit-2026-08-26.md`](player-aid-source-audit-2026-08-26.md).

## First digital slice

The first build intentionally narrows the rules to a testable foundation:

- 2 local players, with the data model ready for 4.
- Six original monster names represented as data only; no original artwork.
- A compact abstract map rather than a reproduction of the original board.
- Move, encounter, deployment, and a basic two-round fight flow.
- A visible turn/phase log so the rules can be playtested.

## Later rules work

The full rulebook still needs to be modelled and tested: three source-gated Research effects (Cutbacks, Molecular Cannon, and Chopper Lift), stomp-marker thresholds on the promoted physical board, Hollywood recovery exceptions, movement abilities on authored water/barrier data, branch-specific exceptions, and the complete physical-board Challenge. Blonde Lure is implemented as a sourced next-move constraint, while the three remaining cards have exact catalogue transcriptions but their target/visibility, all-lair, and authored-terrain boundaries are not yet safe to infer. Mecha-Monster, Captain Colossal, and X-Fighters entry through their Research cards, ordinary giant/X-Fighter combat lifecycle, sharing, permanent removal, giant-last Challenge ordering, and America-saved victory are implemented in the development ruleset from the photographed component records and the [player-aid rules summary](https://www.orderofgamers.com/downloads/MonstersMenaceAmerica_v1.1.pdf); physical giant base coordinates and full-board production enablement remain open.

## Product requirements from the request

- Downloadable clients for iPhone/iPad, Apple TV, and computer.
- Cross-device play with friends.
- A spectator device that can join without logging in.
- Web as the first implementation target.

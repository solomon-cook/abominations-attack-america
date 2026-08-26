# Monsters Menace America v1.1 player-aid audit

## Sources inspected

`/Users/Solomon/Downloads/MonstersMenaceAmerica_v1.1.pdf`

The file is a three-page Universal Head rules summary dated September 2008. Page 1 is a cover/disclaimer; pages 2–3 contain a condensed rules summary. It is not a scan of the physical board, record tiles, or Research/Mutation card faces.

Three additional physical photographs were added to the project in
`references/monsters-menace-america/components/source-photos-2026-08-26/` and
analysed in [`docs/source-photo-evidence-2026-08-26.md`](source-photo-evidence-2026-08-26.md).
They corroborate the giant and National Guard record values and provide board
comparison evidence, but are not treated as a complete cell-level board
transcription.

## Rules confirmed by this copy

- Setup uses 20, 17, or 14 Stomp markers for 4, 3, or 2 players.
- The last player to choose a monster chooses a military branch, and the National Guard cannot be chosen.
- With fewer than four players, the last player places each unused non-National Guard branch's units on that branch's bases, one unit per base.
- The National Guard is not controlled by a player under the general rule.
- Monsters can disappear instead of moving and return to a lair on their next turn, restoring starting Health and using that Move step.
- Military movement stops at monsters, allows passage through military units, permits shared spaces, and is constrained by water barriers and movement abilities.
- Normal combat lasts two rounds; surviving military units force monster retreat.
- A monster at zero Health goes to Hollywood before the Monster Challenge and can recover there.
- Deploy allows one military unit per destination space per turn; National Guard has the stated city/base/Infamy deployment scope.
- Redeployment excludes National Guard, Captain Colossal, and Mecha-Monster; giant placement does not consume the normal deployment slot.
- The Monster Challenge sequence, giant-last ordering, and America-saved outcome are summarized.

These statements corroborate existing canonical transcription and tests. They do not by themselves establish board coordinates or component-specific values.

## Missing from this copy

The player aid does not resolve:

- the 245 board cells, coastline, lake/sea classes, barriers, printed labels, benefits, bases, lairs, or exact feature coordinates;
- monster numeric records, named lair locations, or special ability timing/effects;
- military record-tile statistics, quantities beyond the setup summary, or branch-specific exceptions;
- the text, timing, targets, visibility, duration, and stacking behavior of individual Research or Mutation cards;
- the exact physical National Guard pieces' board placement and lifecycle exceptions;
- the physical base coordinates for Captain Colossal and Mecha-Monster;
- the cell-level transcription and alignment needed to promote the photographed
  board from comparison evidence to verified board data;
- the three unresolved Research cards: Cutbacks, Molecular Cannon, and Chopper Lift.

## Disposition

No remaining source-gated category is closed solely from this PDF. The fewer-than-four-player setup sub-rule is already confirmed and tracked separately in `TODO.md`; its exact board placement remains dependent on verified base coordinates. The PDF should be retained as corroborating rules evidence, not promoted to board or card authority.

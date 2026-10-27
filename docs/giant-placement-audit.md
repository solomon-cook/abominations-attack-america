# Giant placement source audit

This audit separates the giant-unit rules established by the photographed
components and rules reference from the placement edges those sources do not
settle. The latter remain gated in the [unresolved-rules inventory](unresolved-rules-inventory.md).

## Source-backed behavior

The Mecha-Monster and Captain Colossal Military Research cards each say to
place the giant on one of the player's bases, take its record tile, remove it
from the game at 0 Health, and discard the card after use. The photographed
cards are [Military Research sheet 01](../references/monsters-menace-america/components/decks/military-research-01.jpg)
and [sheet 03](../references/monsters-menace-america/components/decks/military-research-03.jpg).

The general rules reference adds that a giant may share a space with normal
military units or the other giant; placement does not use a normal Deploy
allowance; and giants cannot be redeployed. See
[Giant military units](monsters-menace-america-rules.md#giant-military-units)
and [Redeploying](monsters-menace-america-rules.md#redeploying). The board's
reviewed branch ownership determines which bases satisfy “one of your bases.”
The timing sequence also establishes that card placement at a monster's space
does not itself start a battle: the Fight rules start battles from movement
(page 7), and the Deploy rules permit deployment into a monster's space
(page 14). This is a timing interpretation from those rules, not a claim that
the giant card separately grants permission to share a space with a monster.

The current engine uses the pinned board to list the active player's branch
bases, limits each giant to one living instance, discards the card, preserves
the ordinary deployment allowance, and permanently removes the giant at zero
Health. Placement at a Monster-occupied base stays in Deploy without creating
a pending battle, with a focused regression.

## Stomped-base ruling

The giant card's immediate instruction is to place its piece on “one of your
bases” (Mecha-Monster and Captain Colossal, Military Research sheets 01 and 03).
The general Deploy rules restrict ordinary branch deployment to unstomped bases
(rulebook page 14), and the giant-unit rule on that same page explicitly says
placing a giant on a base does not count as deploying a unit there that turn.
The rulebook also establishes that a component's special instruction overrides
a general rule.

Therefore the stomped-base deployment restriction does not apply to this
separate card placement: any base belonging to the cardholder's branch remains
a legal destination, including a base already stomped. The engine's legal-base
selector follows the card's full “one of your bases” scope; a regression
verifies both giant cards can resolve onto a stomped owned base. This ruling
does not change ordinary unit deployment, which remains prohibited on stomped
bases.

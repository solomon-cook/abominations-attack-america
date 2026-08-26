# Monsters Menace America - Rules Reference

> Canonical source for engine implementation and rules tests.
>
> Derived from the supplied 16-page 2005 *Monsters Menace America* rulebook
> (`766630657-monsters-menace-america.pdf`), cross-checked against its supplied
> text extraction. This is a structured paraphrase, not a replacement scan or a
> transcription of card and record-tile content.

## Source authority

1. A monster, military unit, Mutation card, or Research card may contain a
   special rule that overrides a general rule in this document.
2. When a special rule conflicts with a general rule, follow the special rule.
3. Values such as Move, Defense, Damage, Attacks, deployment allowances,
   starting Health, unit inventories, and special abilities come from the
   relevant record tile or card unless this document states a universal value.
4. The physical board determines adjacency, water barriers, city sizes, base
   ownership, site types, monster lairs, and Challenge-site locations.

This hierarchy must also apply in the game engine. A general-rule test must not
silently override a card, unit, monster, or board-space exception.

## Confirmed digital interpretations

The original rulebook leaves a few edge cases implicit. The following rulings
are confirmed for this implementation:

- Fly permits a monster to pass through another monster's space before the
  Monster Challenge, but not to finish its move there.
- A battle is compulsory when movement creates one, including a battle between
  a player's monster and military branch. Both sides make their full attacks.
- Each branch's owner resolves the attacks and decisions for that branch's
  defending units, even outside that owner's turn.
- The National Guard is neutral by default. When its units participate in a
  battle, the active player resolves their required attacks unless a special
  card has granted National Guard control to a player.
- Infamy may be spent for another attack after seeing earlier attack results,
  but it must be spent before rolling the additional attack.
- If a stomped military base's branch has no unit remaining on either the board
  or its record tile, the trophy portion is skipped. The stomp and Infamy gain
  still resolve normally.
- If both giant military units enter the Monster Challenge, the monster
  challenger chooses which one to fight first. If a giant unit defeats the
  challenger, that giant unit's controller wins immediately. If the monster
  wins, it proceeds to the other surviving giant unit.
- The Health maximum of 40 applies throughout the game, including Health gained
  during the Monster Challenge.
- A disappeared monster remains eligible for the Monster Challenge. When it is
  chosen, it immediately appears in the challenger's space. Only a monster in
  Hollywood is ineligible.

## Game overview

- Players: 2-4.
- Each player controls one giant monster and one military branch.
- The National Guard is neutral under the general rules. A special Military
  Research card may grant control as an exception.
- Players strengthen their monsters through Health, Mutation cards, and Infamy,
  while using military units to weaken or delay opposing monsters.
- The normal game ends in the Monster Challenge. The last surviving eligible
  monster wins, unless a giant military unit survives the Challenge and saves
  America for its controller.

## Setup

### Shared setup

1. Randomly determine the first player.
2. Place the board and three dice within reach.
3. Create the Stomp-marker stack using the player-count limit:

   | Players | Stomp markers |
   | ---: | ---: |
   | 2 | 14 |
   | 3 | 17 |
   | 4 | 20 |

   Extra Stomp markers are kept outside this stack for spaces stomped after the
   Monster Challenge has been declared.
4. Place the Infamy tokens near the board.
5. Shuffle the Monster Mutation and Military Research decks separately and
   place both face down.
6. Place the National Guard record tile and units near the board.

### Choose monsters and military branches

1. Starting with the first player and continuing to the left, each player
   chooses an unclaimed monster, takes its piece and record tile, and sets its
   Health to the printed starting value.
2. The player who chose a monster last chooses an eligible military branch
   first. Continue choosing branches to the right until every player has one.
   The National Guard cannot be chosen.
3. Each player takes the record tile and units belonging to their branch and
   places the units in the indicated spaces on that tile.
4. With fewer than four players, the last player places each unused non-National
   Guard branch's units on that branch's board bases, one unit per base.

### Starting positions

Starting with the first player and continuing to the left, each player:

1. Places their monster on one of that monster's three printed lairs.
2. Either performs an initial deployment using the normal Deploy rules or draws
   one Military Research card.

## Turn structure

Players take turns to the left, beginning with the first player. A turn has four
ordered steps:

1. **Move:** Move the active player's monster and military units.
2. **Fight:** Resolve every battle started by that movement.
3. **Encounter:** If the monster did not retreat, resolve the space where it
   finished moving and fighting.
4. **Deploy:** Deploy military units, redeploy eligible units, or draw one
   Military Research card instead.

## 1. Move

The active player may move their monster and any number of units from their own
military branch. Movement is optional for every piece.

### Monster movement

- A monster may move from zero spaces up to its printed Move value.
- It stops immediately when it enters a space containing any military unit,
  including one belonging to its player's own branch.
- Before the Monster Challenge, it cannot enter or pass through a space
  containing another monster.
- It cannot cross a water barrier without the appropriate movement ability.
- It encounters only its final space, never a space it merely passes through.

### Disappearing instead of moving

The active player may make their monster disappear instead of moving it:

1. Remove the monster from the board for the rest of the current turn.
2. On that player's next turn, place it on one of its own lairs.
3. That placement is its entire Move step for the turn.
4. If its Health is below its printed starting Health, restore it to its
   starting Health.

A monster in Hollywood cannot disappear.

### Military-unit movement

- Each unit from the active player's branch may move from zero spaces up to its
  printed Move value.
- A player cannot move National Guard units, even if that player deployed them.
- A unit stops immediately when it enters a space containing any monster,
  including its player's monster.
- A unit may move through spaces containing other military units, including
  giant military units.
- Any number of units, including units from different branches, may share a
  space.
- A unit cannot cross a water barrier without the appropriate movement ability.

### Movement abilities

- **Fly:** Ignores water barriers and may pass through spaces containing units
  or monsters without stopping. Before the Monster Challenge, this permits a
  flying monster to pass through another monster's space, but not to finish its
  move there.
- **Lake:** May cross water barriers on inland bodies of water only.
- **Sea:** May cross water barriers on sea spaces.
- **Sea/Seacoast Only:** May enter a space only when the starting space, the
  destination, and every intervening space contain water.

## 2. Fight

### Starting and ordering battles

A battle starts when movement causes either of these states:

- The active monster finishes moving in a space containing one or more military
  units, including units from its player's branch.
- One or more active-player military units finish moving in a space containing
  a monster, including that player's monster.

If the active player starts multiple battles, that player chooses their
resolution order.

Once created, a battle is compulsory. This includes a battle involving the
active player's monster and that player's own military branch. Each branch
owner resolves their units' attacks and decisions. The active player resolves
neutral National Guard attacks unless a special card grants their control to a
player.

Outside the Monster Challenge, a battle lasts exactly two combat rounds. In
each round:

1. The monster makes all of its attacks.
2. Each surviving military unit makes its attacks.

### Attack resolution

Resolve every attack separately:

1. Choose one legal target.
2. Roll one die.
3. The attack hits when the result is greater than or equal to the target's
   Defense.
4. On a natural roll of 6, the hit is a **smash** and deals 1 additional point
   of damage.

An attacker with multiple attacks may target the same defender more than once.
The player may see the result of one attack before choosing the next target.

### Monster attacks

- A monster starts the game with three attacks per combat round unless modified
  by a special rule.
- Before the Monster Challenge, monsters may attack only military units.
- A monster may spend an Infamy token at any time to gain one extra attack,
  including during the Monster Challenge. It may do so after seeing an earlier
  attack result, but must spend the Infamy before rolling the additional attack.

### Military attacks

- Most military units make one attack per combat round; use the record tile or
  card for exceptions.
- Military units may attack only monsters, never other military units.

### Attacks that cause mutations

Some military-unit attacks instruct the defending monster to mutate. When such
an attack causes a mutation:

1. The monster's player draws a Monster Mutation card.
2. The card takes effect immediately.
3. When several mutation-causing units attack, resolve each attack separately.
   A mutation gained from one attack can affect the monster before later units
   attack it.

### Damage and destruction

- When a monster or military unit hits a monster, reduce the monster's Health by
  the attacker's Damage, plus 1 for a smash.
- When a monster hits a normal military unit, that unit is destroyed regardless
  of the monster's printed Damage.
- A destroyed normal unit returns to its branch's record tile and may be
  deployed later unless another rule permanently removes it.
- Before the Monster Challenge, a monster reduced to 0 Health goes to Hollywood.
- During the Monster Challenge, a monster reduced to 0 Health is knocked out of
  the game instead.
- Giant military units use their own Health and destruction rules.

### Retreating after a normal battle

If at least one military unit survives both rounds, the monster must retreat to
an adjacent space. Military units never retreat.

- A retreating monster does not encounter either the battle space it left or
  its destination. It cannot stomp, mutate, or resolve another encounter.
- It cannot retreat into a space containing another player's military units or
  any monster.
- It cannot cross a water barrier without the necessary movement ability.
- If no legal retreat space exists, it must disappear.
- When the active monster attacked enemy units and must retreat, it returns to
  the adjacent space from which it entered the battle.
- When the active player's units attacked a monster and force it to retreat,
  the active player chooses its legal retreat space and draws one Military
  Research card.

### Hollywood

Before the Monster Challenge, a monster reduced to 0 Health is sent to
Hollywood:

1. Place it in the board's Hollywood area.
2. Discard all Infamy tokens held by that monster.
3. If another player caused the monster to reach 0 Health on that player's
   turn, that player draws one Military Research card.

At the beginning of each turn while the monster is in Hollywood:

1. Roll one die and add the result to its Health.
2. If its Health remains below 5, it stays in Hollywood.
3. Once its Health reaches at least 5, it breaks free during that turn's Move
   step. Place it in Los Angeles or on one of its own lairs. That placement is
   its entire movement for the turn.
4. If Los Angeles contains another monster, it must use one of its own lairs.

A monster in Hollywood cannot disappear and cannot participate in the Monster
Challenge.

## 3. Encounter

After moving and resolving all relevant battles, the active monster encounters
its current space unless it retreated. Resolve every icon on a multi-icon space.

### Stomping

A monster stomps an unstomped space containing a city, military base, or Infamy
site:

1. Take one marker from the active Stomp stack and cover the space.
2. A stomped space cannot be stomped again.
3. Resolve the benefit of every city, base, and Infamy icon in that space.
4. The monster whose player takes the final marker from the active stack
   declares the Monster Challenge.

#### City benefit

The monster gains Health based on the city's printed category:

| Board icon | Health gained |
| --- | --- |
| `1hp` | 1 Health |
| `1d` | Roll 1 die and gain the result |
| `2d` | Roll 2 dice and gain the total |
| `3d` | Roll 3 dice and gain the total |

A monster's Health cannot exceed 40.

#### Military-base benefit

1. The monster gains one Infamy token.
2. The player who controls the branch owning that base gives the monster one
   unit from that branch as a trophy. This also applies when a player's own
   monster stomps their military branch's base.
3. That branch's player chooses whether the trophy comes from the board or the
   branch record tile.
4. The trophy unit is permanently unavailable for deployment.
5. No units may be deployed on a stomped base.

If no unit from that branch remains on either the board or its record tile, skip
the trophy portion. The monster still gains the Infamy and the base remains
stomped.

#### Infamy-site benefit

The monster gains two Infamy tokens.

### Infamy

- Each Infamy token may be spent for one additional monster attack at any time,
  including during the Monster Challenge.
- Tokens may have denominations of 1 and 5; a value-5 token represents five
  Infamy.
- A monster may hold no more than 15 Infamy at once. Any gain above 15 is lost.
- Infamy belongs to the monster and is discarded if that monster goes to
  Hollywood.

### Mutation sites

- When a monster encounters a Mutation site it has not previously used, draw
  one Monster Mutation card and place it face up. Its effect is immediate.
- Each monster may mutate only once at each individual Mutation site.
- A later visit by the same monster to that site has no effect.
- Another monster may still use that site if it has not previously done so.

### Challenge sites

- Before the Monster Challenge is declared, a Challenge site has no effect.
- After the declaration, another monster that reaches a Challenge site becomes
  the new challenger, and the Monster Challenge begins at the end of that turn.

### Other spaces

- A blank space has no encounter effect.
- A stomped space has no further encounter effect.
- A monster lair has no encounter effect.

## 4. Deploy

During the Deploy step, use the active player's military-branch record tile to
determine the permitted number and mix of deployments.

### Normal deployment

- At most one military unit, from any branch, may be deployed into a given
  board space during a single turn.
- Units from the player's own branch may be deployed only on unstomped bases
  belonging to that branch.
- National Guard units may be deployed on any unstomped city, military base, or
  Infamy site.
- A unit may be deployed into a legal space that contains a monster.
- A player cannot exceed the unit inventory or the branch's printed deployment
  allowance.

### Redeploying

- The player may remove one of their branch's units from the board and place it
  on any unstomped base belonging to that branch.
- Each redeployed unit counts as one deployment from that branch's allowance.
- Normally, National Guard units cannot be redeployed. Guard Commander overrides
  that prohibition for the cardholder: either Guard unit may be redeployed to an
  unstomped base belonging to the cardholder's military branch.
- Guard Commander redeployment uses the branch's normal own-or-Guard allowance,
  including its printed additional Guard allowance and any 2nd Generation bonus.
- Captain Colossal and Mecha-Monster cannot be redeployed.

### Military Research instead of deployment

The active player may draw one Military Research card instead of deploying any
units. Place the card face up immediately and apply any immediate instruction.

### Mutation and Research card decks

- Drawn cards are placed face up in front of the receiving player.
- Cards without lasting effects state when they may be used.
- When either deck is empty, do not reshuffle its discard pile. No more cards of
  that type can be drawn.

## Giant military units

Captain Colossal and Mecha-Monster enter play through Military Research cards.
They follow these rules in addition to their card and record-tile rules:

- They have Health and take damage in the same general manner as monsters.
- Captain Colossal can make two attacks per combat round.
- At 0 Health, a giant unit is permanently removed from the game and cannot
  return.
- A giant unit cannot mutate, stomp, or declare the Monster Challenge.
- It may share a space with normal military units or the other giant unit.
- Placing a giant unit on a base does not count as deploying a unit into that
  space for the turn.
- Giant units cannot be redeployed.
- During the Monster Challenge, any giant unit in play must be the last creature
  challenged, even when its controller also controls the challenging monster.
- Giant units do not weigh in, and they never fight each other.
- If Captain Colossal or Mecha-Monster is still standing at the end of the
  Monster Challenge, America is saved and that giant unit's controller wins.

## The Monster Challenge

### Declaring and timing the Challenge

1. The monster whose player takes the last marker from the active Stomp stack
   automatically becomes the challenger.
2. By default, the Challenge starts in that monster's space at the start of its
   player's next turn.
3. Before then, another eligible monster can reach one of the four Challenge
   sites and become the new challenger. If that happens, the Challenge begins
   at the end of that monster's turn.
4. Stomps after declaration use extra markers and do not create another
   declaration.
5. A challenger forced to retreat remains the challenger.
6. A challenger that disappears or goes to Hollywood loses challenger status.
   The next eligible monster to reach a Challenge site becomes challenger.
7. Monsters in Hollywood cannot participate.

### Challenge sequence

Repeat this sequence until the final eligible opponent has been defeated:

1. The challenger's player chooses another eligible monster. That monster
   immediately appears in the challenger's space. A disappeared monster is
   eligible; only a monster in Hollywood is excluded.
2. Record each monster's current Health as its **weigh-in Health**.
3. Fight without a two-round limit. In each round the challenger makes all of
   its attacks first, then the surviving opponent makes all of its attacks.
   Monsters may target each other during the Challenge. Continue until one
   monster reaches 0 Health.
4. The winner gains Health equal to the loser's weigh-in Health. The normal
   maximum Health of 40 still applies unless a special rule overrides it.
5. The winning monster remains or becomes the challenger and immediately
   chooses the next eligible monster to fight.
6. After all monsters, challenge any giant military unit still in play. If both
   are present, the monster challenger chooses their order. Giant units never
   fight each other.
7. If a giant unit defeats the monster challenger, that giant unit's controller
   wins immediately. If the monster defeats it, the monster proceeds to the
   next surviving giant unit, if any.

### Winning

- If a giant military unit remains standing at the end of the Challenge, its
  controller wins by saving America.
- Otherwise, the last surviving monster is King of the Giant Monsters and its
  controller wins.

## Engine invariants and required state

The engine must represent enough state to enforce the rules above without
relying on the user interface. At minimum it needs:

- player order, active player, and the four ordered turn steps;
- monster ownership, position or off-board status, Health, starting Health,
  attacks, Infamy, mutations, used Mutation sites, and challenger status;
- military-branch ownership, neutral National Guard status, unit positions,
  unit availability, permanently removed trophies, and deployment allowances;
- board adjacency, water barriers, water-space classifications, site icons,
  base ownership, city benefit, stomp state, lairs, Los Angeles, Hollywood, and
  Challenge sites;
- per-piece Move, Defense, Damage, Attacks, movement abilities, and special-rule
  overrides;
- Stomp-stack size based on player count and whether the Challenge is declared;
- current battles, combat round, attack order, legal targets, retreat ownership,
  and whether an encounter is prohibited by retreat;
- Mutation and Research deck order, face-up cards, exhaustion, and immediate or
  persistent card effects;
- Monster Challenge timing, weigh-in Health for each duel, duel order, defeated
  creatures, giant-unit-last ordering, and the final winner condition.

## Deliberately unresolved implementation inputs

The supplied rulebook does not fully define the following without the physical
components. These must come from authoritative board, record-tile, and card data
rather than being guessed:

- the complete map geometry and every printed space/icon;
- each monster's and unit's numeric stats and special ability text;
- each military branch's unit inventory and deployment formula;
- the full Mutation and Research card lists and effects;
- the exact text, duration, and scope of the Military Research card that grants
  control of the National Guard;
- the exact placement rules printed on cards that introduce giant units;
- special cases that override the general rules in this reference.

Until those sources are captured, the engine should mark such content as
unsupported or data-incomplete rather than inventing substitute rules.

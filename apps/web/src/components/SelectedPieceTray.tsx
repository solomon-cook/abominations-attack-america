import { boardForState, getLocation, isHexKey, shortestLegalUnitPaths, monsterCombatStats, monsterDefinition, UNIT_DEFINITIONS, NATIONAL_GUARD_DEFINITIONS, GIANT_UNIT_DEFINITIONS, type GameState, type HexKey } from "@abominations/game-engine";
import { movementLabel, SheetStats } from "./SheetReference";
import { monsterAssetSlug } from "../monster-assets";

type Props = { game: GameState; selectedUnitId: string | null; selectedUnitPath: readonly HexKey[]; onClear: () => void; canLaunchSubmarine: boolean; choosingSubmarineTarget: boolean; onLaunchSubmarine: () => void };

export function SelectedPieceTray({ game, selectedUnitId, selectedUnitPath, onClear, canLaunchSubmarine, choosingSubmarineTarget, onLaunchSubmarine }: Props) {
  const unit = game.units.find((candidate) => candidate.id === selectedUnitId);
  if (!unit) {
    const monster = game.monsters[game.currentPlayer];
    const definition = monsterDefinition(monster.name.toLowerCase());
    const moved = game.movedPieceIds.includes(monster.id);
    const combatStats = monsterCombatStats(game, monster);
    return <section className="piece-detail-tray monster-command-record" aria-label="Selected piece details">
      <div className="command-portrait"><img src={`/assets/monsters/portraits/${monsterAssetSlug(monster.name)}.webp`} alt="" /></div>
      <div className="command-record-body">
        <div className="command-identity"><div><span className="command-eyebrow">MONSTER RECORD · PLAYER {game.currentPlayer + 1}</span><h3>{monster.name}</h3></div><span className="command-infamy" title="Infamy">★ <b>{monster.infamy}</b><small>INFAMY</small></span></div>
        <div className="command-health"><span>HEALTH <b>{monster.health}<small> / {monster.maxHealth}</small></b></span><meter aria-label="Monster health" min={0} max={monster.maxHealth} value={monster.health} /></div>
        <SheetStats values={{ Move: combatStats.move, Attacks: combatStats.attacks, Defense: combatStats.defense, Damage: combatStats.damage }} />
        <div className="command-movement">{movementLabel(monster.movement)}<span>{moved ? "✓ Movement complete" : game.phase === "move" ? "Ready to move" : game.phase}</span></div>
        {definition && <details className="command-ability"><summary>Special ability</summary><p>{definition.specialAbilityText}</p></details>}
      </div>
    </section>;
  }
  const definition = UNIT_DEFINITIONS.find((candidate) => candidate.id === unit.unitTypeId);
  const guard = NATIONAL_GUARD_DEFINITIONS.find((candidate) => candidate.id === unit.unitTypeId);
  const giant = GIANT_UNIT_DEFINITIONS.find((candidate) => candidate.id === unit.unitTypeId);
  const name = definition?.name ?? guard?.name ?? giant?.name ?? unit.unitTypeId?.replaceAll("-", " ") ?? unit.branch;
  const board = boardForState(game);
  const locationName = (key: string) => getLocation(key)?.name ?? (isHexKey(key) ? board.hexes[key]?.label ?? "On the board" : key === "record-tile" ? "In reserve" : key);
  const canMove = shortestLegalUnitPaths(game, unit.id).length > 0;
  const status = game.movedPieceIds.includes(unit.id) ? "Already moved this turn."
    : selectedUnitPath.length > 1 ? `Previewing ${selectedUnitPath.length - 1} spaces to ${locationName(selectedUnitPath.at(-1)!)}.`
    : canMove ? "Choose a glowing destination to preview this unit’s move." : "This unit cannot move at this point in the turn.";
  const special = definition?.specialAbilityText ?? guard?.specialAbilityText;
  return <section className="piece-detail-tray unit-command-record" aria-label="Selected piece details" aria-live="polite">
    <div className="unit-detail-heading">
      <img src={giant ? `/assets/military/portraits/${giant.id}.webp` : `/assets/military/${unit.unitTypeId === "navy-nuclear-submarine-missile" ? "navy-launched-cruise-missile" : unit.unitTypeId ?? "army-tank"}.webp`} alt={name} />
      <div><span className="label">{unit.branch} · {locationName(unit.location)}</span><h3>{name}</h3></div>
    </div>
    <SheetStats values={{ Move: unit.move, Attacks: unit.attacks, Defense: unit.defense, Damage: unit.damage, ...(giant ? { Health: unit.health } : {}) }} />
    <span className="unit-movement-type">{movementLabel(unit.movement)}</span>
    {unit.unitTypeId === "navy-nuclear-submarine" && <div className="unit-special-rules"><strong>Submarine / cruise missile</strong><p>Submarine: move 4 through sea and seacoast, defense 5, damage 1.</p><p>As a cruise missile: fly up to 8, defense 6, damage 3.</p></div>}
    {unit.unitTypeId === "navy-nuclear-submarine" && <div><button type="button" disabled={!canLaunchSubmarine || choosingSubmarineTarget} onClick={onLaunchSubmarine}>Launch as cruise missile</button><p>{choosingSubmarineTarget ? "Choose a glowing monster on the board, or cancel." : canLaunchSubmarine ? "Choose an opposing monster within 8 flying spaces." : "Requires an unmoved submarine and an opposing monster within 8 flying spaces during Move."}</p></div>}
    {special && <details className="unit-special-rules"><summary>Special ability</summary><p>{special}</p></details>}
    {(!canMove || selectedUnitPath.length > 1 || game.phase !== "move") && <p className="unit-selection-status">{status}</p>}
    <button type="button" className="stack-clear" onClick={onClear} aria-label={`Deselect ${name}`} title="Deselect">×</button>
  </section>;
}

import { boardForState, isHexKey, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canAct: boolean;
  selectedUnitId: string | null;
  movableUnitIds: ReadonlySet<string>;
  monsterCanMove: boolean;
  onSelect: (unitId: string | null) => void;
  onEnd: () => void;
};

export function MovementChecklist({ game, canAct, selectedUnitId, movableUnitIds, monsterCanMove, onSelect, onEnd }: Props) {
  const monster = game.monsters[game.currentPlayer];
  const board = boardForState(game);
  const controlsGuard = game.players[game.currentPlayer]?.researchCardIds.includes("Guard Commander");
  const units = game.units.filter((unit) => isHexKey(unit.location) && !game.removedUnitIds.includes(unit.id)
    && (unit.ownerPlayer === game.currentPlayer || unit.branch === "National Guard" && controlsGuard));
  const pieces = [
    { id: monster.id, name: monster.name, kind: "Monster", selected: selectedUnitId === null, movable: monsterCanMove, unitId: null },
    ...units.map((unit) => ({ id: unit.id, name: (unit.unitTypeId ?? unit.branch).replaceAll("-", " "),
      kind: isHexKey(unit.location) ? board.hexes[unit.location]?.label ?? unit.branch : unit.branch,
      selected: selectedUnitId === unit.id, movable: movableUnitIds.has(unit.id), unitId: unit.id })),
  ];
  const remaining = pieces.filter((piece) => piece.movable).length;
  return <section className="movement-checklist" aria-label="Movement checklist">
    <div className="movement-checklist-heading"><strong>Movement orders</strong><span aria-live="polite">{remaining} available</span></div>
    <div className="movement-piece-list">
      {pieces.map((piece) => {
        const moved = game.movedPieceIds.includes(piece.id);
        return <button type="button" key={piece.id} className={`movement-piece ${piece.selected && (piece.unitId !== null || piece.movable) ? "selected" : ""} ${moved ? "completed" : ""}`}
          aria-pressed={piece.selected && (piece.unitId !== null || piece.movable)} disabled={piece.unitId === null && (!canAct || !piece.movable)} onClick={() => onSelect(piece.unitId)}>
          <span className="movement-piece-icon" aria-hidden="true">{moved ? "✓" : piece.movable ? "→" : "—"}</span>
          <span><strong>{piece.name}</strong><small>{piece.kind}</small></span>
          <span className="movement-piece-status">{moved ? "Resolved" : piece.movable ? "Move" : "No moves"}</span>
        </button>;
      })}
    </div>
    {!units.length && <p className="movement-context">No military units on the board under your control.</p>}
    <p className="movement-context">{remaining ? "Choose a piece, then a glowing destination. Unmoved pieces may stay where they are." : "All available movement is resolved. Continue to the next phase."}</p>
    <button type="button" className="end-movement" disabled={!canAct} onClick={onEnd}>End movement →</button>
  </section>;
}

import { getLocation, type GameState, type HexKey } from "@abominations/game-engine";

type Props = {
  game: GameState;
  activeMonsterId: string;
  selectedStackKey: HexKey | null;
  onSelect: (key: HexKey) => void;
  onClear: () => void;
};

export function PieceStackInspector({ game, activeMonsterId, selectedStackKey, onSelect, onClear }: Props) {
  const occupiedStackKeys = [...new Set([
    ...game.monsters.filter((monster) => typeof monster.location === "string" && monster.location.includes(",")).map((monster) => monster.location as HexKey),
    ...game.units.filter((unit) => typeof unit.location === "string" && unit.location.includes(",")).map((unit) => unit.location as HexKey),
  ])];
  const monsters = selectedStackKey ? game.monsters.filter((monster) => monster.location === selectedStackKey) : [];
  const units = selectedStackKey ? game.units.filter((unit) => unit.location === selectedStackKey) : [];

  return (
    <section className="stack-inspector" aria-label="Piece stack inspector">
      <div className="stack-inspector-heading">
        <div><span className="label">PIECE STACKS</span><p>Select an occupied hex to inspect its pieces.</p></div>
        {selectedStackKey && <button type="button" className="stack-clear" onClick={onClear}>Clear</button>}
      </div>
      <div className="stack-location-list">
        {occupiedStackKeys.length === 0 ? <span className="empty-card-state">No pieces on the board.</span> : occupiedStackKeys.map((key) => (
          <button type="button" key={key} className={selectedStackKey === key ? "selected-choice" : ""} onClick={() => onSelect(key)}>
            {getLocation(key)?.name ?? `Hex ${key}`} · {game.monsters.filter((monster) => monster.location === key).length + game.units.filter((unit) => unit.location === key).length} piece(s)
          </button>
        ))}
      </div>
      <div className="piece-legend" aria-label="Piece ownership legend">
        <span><i className="legend-dot own" /> Own</span><span><i className="legend-dot allied" /> Allied</span><span><i className="legend-dot enemy" /> Enemy</span><span><i className="legend-dot neutral" /> Neutral</span>
      </div>
      {selectedStackKey && <div className="stack-details" aria-live="polite">
        <strong>{getLocation(selectedStackKey)?.name ?? `Hex ${selectedStackKey}`}</strong>
        {[
          ...monsters.map((monster) => ({ id: monster.id, role: monster.id === activeMonsterId ? "Own monster" : "Enemy monster", title: monster.name, detail: `${monster.health}/${monster.maxHealth} Health · ${monster.infamy} Infamy · ${monster.location === "hollywood" ? "Hollywood" : "on board"}` })),
          ...units.map((unit) => ({ id: unit.id, role: unit.ownerPlayer === undefined ? "Neutral unit" : unit.ownerPlayer === game.currentPlayer ? "Own unit" : "Enemy unit", title: unit.unitTypeId ?? unit.branch, detail: `${unit.branch} · ${unit.ownerPlayer === undefined ? "Neutral" : `Player ${unit.ownerPlayer + 1}`} · ${unit.health === undefined ? "Health not tracked" : `${unit.health} Health`} · ${game.movedPieceIds.includes(unit.id) ? "moved" : "available"}` })),
        ].map((piece) => <div key={piece.id}><span>{piece.role} · {piece.title}</span><small>{piece.detail}</small></div>)}
      </div>}
    </section>
  );
}

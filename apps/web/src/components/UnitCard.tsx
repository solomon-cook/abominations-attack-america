import { getLocation, legalUnitPaths, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canAct: boolean;
  selectedUnitId: string | null;
  onSelect: (unitId: string) => void;
};

export function UnitCard({ game, canAct, selectedUnitId, onSelect }: Props) {
  const visibleUnits = game.units.filter(
    (unit) =>
      unit.ownerPlayer === game.currentPlayer ||
      (unit.branch === "National Guard" &&
        game.players[game.currentPlayer]?.researchCardIds.includes("Guard Commander")),
  );

  return (
    <div className="card unit-card">
      <span className="label">MILITARY UNITS</span>
      {visibleUnits.map((unit) => {
        const paths = legalUnitPaths(game, unit.id);
        const location = getLocation(unit.location)?.name ?? unit.location;
        return (
          <button
            key={unit.id}
            aria-label={`Your ${unit.branch} unit at ${location}${paths.length ? " · movable" : " · already moved or unavailable"}`}
            className={selectedUnitId === unit.id ? "unit-selected" : ""}
            disabled={!canAct || game.phase !== "move" || !paths.length}
            onClick={() => onSelect(unit.id)}
          >
            {unit.branch} · {location}
          </button>
        );
      })}
    </div>
  );
}

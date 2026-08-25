import { getLocation, type GameState, type HexKey } from "@abominations/game-engine";

type Props = {
  game: GameState;
  selectedUnitId: string | null;
  selectedUnitPath: readonly HexKey[];
  onClear: () => void;
};

export function SelectedPieceTray({ game, selectedUnitId, selectedUnitPath, onClear }: Props) {
  const unit = selectedUnitId ? game.units.find((candidate) => candidate.id === selectedUnitId) : undefined;
  if (!unit) return null;
  const location = getLocation(unit.location)?.name ?? unit.location;
  const preview = selectedUnitPath.length > 1
    ? `Previewing ${selectedUnitPath.length - 1} movement ${selectedUnitPath.length - 1 === 1 ? "space" : "spaces"} to ${getLocation(selectedUnitPath.at(-1)!)?.name ?? selectedUnitPath.at(-1)}`
    : "Choose a highlighted destination to preview a path.";

  return (
    <section className="piece-detail-tray" aria-label="Selected piece details" aria-live="polite">
      <div>
        <span className="label">SELECTED PIECE</span>
        <h3>{unit.branch} · {unit.unitTypeId ?? "unit"}</h3>
        <p>{location} · {preview}</p>
      </div>
      <div className="piece-detail-stats">
        <span><b>{unit.move}</b> move</span>
        <span><b>{unit.defense}</b> defense</span>
        <span><b>{unit.damage}</b> damage</span>
        <span><b>{unit.attacks}</b> attack</span>
      </div>
      <button type="button" className="stack-clear" onClick={onClear}>Deselect</button>
    </section>
  );
}

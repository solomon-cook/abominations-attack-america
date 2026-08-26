import { buildBoardIndex, type BoardDefinition, type BoardHex, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  board?: BoardDefinition;
  hex?: BoardHex;
};

function featureLabel(hex: BoardHex): string {
  if (hex.features.length === 0) return "No recorded feature";
  return hex.features.map((feature) => feature.kind).join(", ");
}

/** Compact, board-adjacent context for the active hex; never invents unresolved data. */
export function BoardContextTray({ game, board, hex }: Props) {
  if (!hex) return null;
  const neighbours = board ? buildBoardIndex(board).neighbours[hex.key] ?? [] : [];
  const occupants = [
    ...game.monsters.filter((monster) => monster.location === hex.key).map((monster) => monster.name),
    ...game.units.filter((unit) => unit.location === hex.key).map((unit) => `${unit.branch} unit`),
  ];
  const unresolved = hex.verification !== "verified";
  const title = hex.label ?? `Hex ${hex.key}`;

  return (
    <section className="board-context-tray" aria-label="Active board hex details" aria-live="polite">
      <div className="board-context-heading">
        <span className="label">ACTIVE HEX</span>
        <h3>{title}</h3>
        <p>q {hex.coord.q}, r {hex.coord.r} · {hex.verification}</p>
      </div>
      <div className="board-context-facts">
        <span><b>{hex.waterClass}</b> water class</span>
        <span><b>{featureLabel(hex)}</b></span>
        <span><b>{occupants.length ? occupants.join(", ") : "Empty"}</b></span>
        <span><b>{neighbours.length}</b> recorded neighbours</span>
      </div>
      <p className="board-context-note">
        {unresolved
          ? "Physical terrain, labels, barriers, and feature ownership remain source-gated for this hex."
          : "Details and legal actions are derived from the canonical board and match state."}
      </p>
    </section>
  );
}

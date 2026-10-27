import { buildBoardIndex, type BoardDefinition, type BoardHex, type GameState } from "@abominations/game-engine";
import { boardHexFeatureLabel } from "../board-feature-label";

type Props = {
  game: GameState;
  board?: BoardDefinition;
  hex?: BoardHex;
  className?: string;
};

/** Compact, board-adjacent context for the active hex; never invents unresolved data. */
export function BoardContextTray({ game, board, hex, className }: Props) {
  if (!hex) return null;
  const neighbours = board ? buildBoardIndex(board).neighbours[hex.key] ?? [] : [];
  const edgeDetails = board
    ? board.edges
      .filter((edge) => edge.enabled && (edge.from === hex.key || edge.to === hex.key))
      .map((edge) => {
        const destination = edge.from === hex.key ? edge.to : edge.from;
        return `${destination}: ${edge.barrier} barrier`;
      })
    : [];
  const occupants = [
    ...game.monsters.filter((monster) => monster.location === hex.key).map((monster) => monster.name),
    ...game.units.filter((unit) => unit.location === hex.key).map((unit) => `${unit.branch} unit`),
  ];
  const monsters = game.monsters.filter((monster) => monster.location === hex.key);
  const unresolved = hex.verification !== "verified";
  const title = hex.label ?? (hex.audit ? `Cell ${hex.audit.row}/${hex.audit.column}` : `Hex ${hex.key}`);

  return (
    <section className={`board-context-tray${className ? ` ${className}` : ""}`} aria-label="Active board hex details" aria-live="polite">
      <div className="board-context-heading">
        <span className="label">ACTIVE HEX</span>
        <h3>{title}</h3>
        <p>{hex.audit ? `Cell ${hex.audit.row}/${hex.audit.column}` : `q ${hex.coord.q}, r ${hex.coord.r} · ${hex.verification}`}</p>
      </div>
      <div className="board-context-facts">
        <span><b>{hex.waterClass === "seacoast" ? "Coast" : hex.waterClass}</b></span>
        <span><b>{boardHexFeatureLabel(hex)}</b></span>
        <span><b>{occupants.length ? occupants.join(", ") : "Empty"}</b></span>
        <span><b>{neighbours.length}</b> neighbours</span>
      </div>
      {edgeDetails.length > 0 && (
        <p className="board-context-edges" aria-label="Recorded edge barriers">
          <b>Edges:</b> {edgeDetails.join(" · ")}
        </p>
      )}
      {monsters.length > 0 && (
        <div className="board-context-occupants" aria-label="Monsters on active hex">
          {monsters.map((monster) => (
            <span key={monster.id}>
              <b>{monster.name}</b> · {monster.health}/{monster.maxHealth} health · {monster.infamy} infamy · {monster.move} move
            </span>
          ))}
        </div>
      )}
      <p className="board-context-note">
        {unresolved
          ? "This development or provisional hex has no approved physical-board detail."
          : "Details and actions come from the game board."}
      </p>
    </section>
  );
}

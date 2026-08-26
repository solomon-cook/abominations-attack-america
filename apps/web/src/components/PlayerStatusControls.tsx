import { useState } from "react";
import { getLocation, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  monster: GameState["monsters"][number];
  branch: string;
};

export function PlayerStatusControls({ game, monster, branch }: Props) {
  const [open, setOpen] = useState<"monster" | "branch" | null>(null);
  const branchUnits = game.units.filter((unit) => unit.branch === branch);
  const deployed = branchUnits.filter((unit) => unit.location !== "record-tile" && !game.removedUnitIds.includes(unit.id)).length;
  const reserve = branchUnits.filter((unit) => unit.location === "record-tile" && !game.removedUnitIds.includes(unit.id)).length;
  const detail = open === "monster" ? (
    <div className="status-lightbox" role="dialog" aria-modal="true" aria-label="Monster details">
      <button type="button" className="lightbox-close" onClick={() => setOpen(null)}>Close</button>
      <span className="label">MONSTER DETAILS</span>
      <h3>{monster.name}</h3>
      <p>{getLocation(monster.location)?.name ?? monster.location}</p>
      <div className="lightbox-stats"><span><span className="metric-icon" aria-hidden="true">♥</span> <b>{monster.health}/{monster.maxHealth}</b> health</span><span><span className="metric-icon" aria-hidden="true">◎</span> <b>{monster.infamy}</b> infamy</span><span><span className="metric-icon" aria-hidden="true">↝</span> <b>{monster.move}</b> move</span><span><span className="metric-icon" aria-hidden="true">⚔</span> <b>{monster.attacks}</b> attacks</span></div>
    </div>
  ) : open === "branch" ? (
    <div className="status-lightbox" role="dialog" aria-modal="true" aria-label="Military branch details">
      <button type="button" className="lightbox-close" onClick={() => setOpen(null)}>Close</button>
      <span className="label">MILITARY DETAILS</span>
      <h3>{branch}</h3>
      <p>{deployed} deployed · {reserve} reserve · {branchUnits.length} recorded pieces</p>
      <div className="lightbox-stats"><span><span className="metric-icon" aria-hidden="true">▣</span> <b>{deployed}</b> deployed</span><span><span className="metric-icon" aria-hidden="true">◇</span> <b>{reserve}</b> reserve</span><span><span className="metric-icon" aria-hidden="true">↝</span> <b>{branchUnits.filter((unit) => game.movedPieceIds.includes(unit.id)).length}</b> moved</span></div>
    </div>
  ) : null;

  return (
    <section className="player-status-controls" aria-label="Player status controls">
      <button type="button" className="status-control monster-control" onClick={() => setOpen("monster")} aria-label={`Open ${monster.name} details`}>
        <span className="status-control-icon">
          <img src={`/assets/monsters/${monster.name.toLowerCase()}.webp`} alt="" aria-hidden="true" />
        </span>
        <strong>{monster.name}</strong>
        <small><span className="metric-icon" aria-hidden="true">♥</span> {monster.health} HP · <span className="metric-icon" aria-hidden="true">◎</span> {monster.infamy} INF</small>
      </button>
      <button type="button" className="status-control branch-control" onClick={() => setOpen("branch")} aria-label={`Open ${branch} details`}>
        <span className="status-control-icon">{branch.slice(0, 1)}</span>
        <strong>{branch}</strong>
        <small><span className="metric-icon" aria-hidden="true">▣</span> {deployed} deployed · <span className="metric-icon" aria-hidden="true">◇</span> {reserve} reserve</small>
      </button>
      {detail}
    </section>
  );
}

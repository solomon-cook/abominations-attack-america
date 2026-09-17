import { SheetCards } from "./SheetCards";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MONSTER_DEFINITIONS, type GameCommand, type GameState } from "@abominations/game-engine";
import { MilitarySheet } from "./MilitarySheet";
import { movementLabel, SheetStats, SourcePhoto } from "./SheetReference";

type Props = { game: GameState; monster: GameState["monsters"][number]; branch: string; playerIndex: number; canAct: boolean; runCommand: (command: GameCommand) => void | Promise<void>; onDeploy: () => void };

function MonsterSheet({ monster, game, playerIndex, canAct, runCommand, onClose }: Pick<Props, "monster" | "game" | "playerIndex" | "canAct" | "runCommand"> & { onClose: () => void }) {
  const definition = MONSTER_DEFINITIONS.find((candidate) => candidate.name === monster.name);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="military-sheet-backdrop" onClick={onClose}>
    <div className="military-hand monster-reference-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby="monster-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), summary, select:not(:disabled)") ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="military-hand-toolbar"><span className="label">MONSTER RECORD SHEET</span><button className="military-sheet-close" onClick={onClose}>Close</button></div>
      <div className="military-sheet physical-monster-sheet">
        <img className="monster-sheet-portrait" src={`/assets/monsters/${monster.name.toLowerCase()}.webp`} alt={monster.name} />
        <h2 id="monster-sheet-title">{monster.name}</h2>
        <div className="monster-health-track" role="meter" aria-label="Monster health" aria-valuemin={0} aria-valuemax={monster.maxHealth} aria-valuenow={Math.min(monster.maxHealth, Math.max(0, monster.health))}>
          <div><span>HEALTH</span><strong>{monster.health} <small>/ {monster.maxHealth}</small></strong></div>
          <div className="monster-health-ticks" aria-hidden="true">{Array.from({ length: monster.maxHealth + 1 }, (_, value) => <i key={value} className={value <= monster.health ? "filled" : ""}>{value % 10 === 0 ? <span>{value}</span> : null}</i>)}</div>
        </div>
        <h3>Current game values</h3>
        <SheetStats values={{ Health: `${monster.health} / ${monster.maxHealth}`, Infamy: monster.infamy, Move: monster.move, Movement: movementLabel(monster.movement), Attacks: monster.attacks, Defense: monster.defense, Damage: monster.damage }} />
        <SheetCards game={game} playerIndex={playerIndex} kind="mutation" canAct={canAct} runCommand={runCommand} />
        {definition && <>
          <h3>Printed reference values</h3>
          <SheetStats values={{ "Starting health": definition.startingHealth, Move: definition.move, Movement: movementLabel(definition.movement), Attacks: definition.attacks, Defense: definition.defense, Damage: definition.damage }} />
          <h3>Special ability</h3><p>{definition.specialAbilityText}</p>
          <p className="sheet-reference-note">Mutation cards and combat conditions can change these values.</p>
          <div className="monster-record-skyline" aria-hidden="true">
            <svg viewBox="0 0 600 70" preserveAspectRatio="none"><path d="M0 70V40H20V18H35V9H40V18H55V48H70V30H88V10H112V40H130V25H148V50H163V16H176V3H182V16H199V40H218V27H238V8H260V40H280V22H300V49H320V19H332V0H337V19H350V37H373V12H394V28H414V46H436V16H455V6H460V16H476V38H497V23H518V46H535V12H557V30H580V20H600V70Z" /></svg>
            <span>MONSTER RECORD · {monster.name.toUpperCase()}</span>
          </div>
          <SourcePhoto file={definition.sourceRefs[0].split("/").at(-1)!} />
        </>}
      </div>
    </div>
  </div>;
}

export function PlayerStatusControls({ game, monster, branch, playerIndex, canAct, runCommand, onDeploy }: Props) {
  const [open, setOpen] = useState<"monster" | "branch" | null>(null);
  const playCard = (command: GameCommand) => { setOpen(null); return runCommand(command); };
  return <>
    <div className="player-sheet-controls" aria-label={`Player ${playerIndex + 1} reference sheets`}>
      <button className="ghost" onClick={() => setOpen("monster")}>Monster sheet</button>
      <button className="ghost" onClick={() => setOpen("branch")}>Military sheet</button>
    </div>
    {open && createPortal(open === "monster"
      ? <MonsterSheet monster={monster} game={game} playerIndex={playerIndex} canAct={canAct} runCommand={playCard} onClose={() => setOpen(null)} />
      : <MilitarySheet playerIndex={playerIndex} canAct={canAct} runCommand={playCard} onDeploy={() => { setOpen(null); onDeploy(); }} branch={branch} game={game} choices={[]} referenceOnly onSelect={() => {}} onClose={() => setOpen(null)} />, document.body)}
  </>;
}

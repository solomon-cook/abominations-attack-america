import { ownedMilitarySheets } from "./owned-sheets";
import { SheetCards } from "./SheetCards";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MONSTER_DEFINITIONS, type GameCommand, type GameState } from "@abominations/game-engine";
import { MilitarySheet, type DeploymentChoice } from "./MilitarySheet";
import { movementLabel, SheetStats, SourcePhoto } from "./SheetReference";

type Props = { game: GameState; monster: GameState["monsters"][number]; branch: string; playerIndex: number; canAct: boolean; runCommand: (command: GameCommand) => void | Promise<void>; onDeploy: (sheet?: string) => void; onSelectDeployment?: (choice: DeploymentChoice) => void };

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
        const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, select:not(:disabled), [tabindex="0"]') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="military-hand-toolbar"><span className="label">MONSTER RECORD SHEET</span><button className="military-sheet-close" onClick={onClose}>Close</button></div>
      <p className="monster-sheet-scroll-hint">Swipe across to view the mutation cards beside your sheet.</p>
      <div className="monster-sheet-workspace">
      <div className="military-sheet physical-monster-sheet">
        <div className="monster-physical-record" role="group" aria-label={`${monster.name} physical-style record`}>
          <div className="record-health-rail tens" aria-label="Health tens">{[0, 10, 20, 30, 40].map((value) => <span key={value} className={Math.floor(monster.health / 10) * 10 === value ? "health-marker" : ""}>{value}</span>)}<small>HEALTH</small></div>
          <div className="monster-record-face">
            <h2 id="monster-sheet-title">{monster.name}</h2>
            <div className="monster-record-columns">
              <div className="monster-printed-stats"><SheetStats values={{ "Starting health": definition?.startingHealth ?? monster.startingHealth, Move: definition?.move ?? monster.move, Movement: movementLabel(definition?.movement ?? monster.movement), Defense: definition?.defense ?? monster.defense }} />
                <img className="monster-record-portrait" src={`/assets/monsters/portraits/${monster.name.toLowerCase()}.webp`} alt={`${monster.name} portrait`} />
              </div>
              <div className="monster-printed-ability"><SheetStats values={{ Attacks: definition?.attacks ?? monster.attacks, Damage: definition?.damage ?? monster.damage }} /><h3>Special ability</h3><p>{definition?.specialAbilityText}</p>
                <p className="record-live-health"><b>{monster.health}</b> / {monster.maxHealth} Health<br /><b>{monster.infamy}</b> Infamy</p>
              </div>
            </div>
          <div className="monster-record-skyline" aria-hidden="true">
            <svg viewBox="0 0 600 70" preserveAspectRatio="none"><path d="M0 70V40H20V18H35V9H40V18H55V48H70V30H88V10H112V40H130V25H148V50H163V16H176V3H182V16H199V40H218V27H238V8H260V40H280V22H300V49H320V19H332V0H337V19H350V37H373V12H394V28H414V46H436V16H455V6H460V16H476V38H497V23H518V46H535V12H557V30H580V20H600V70Z" /></svg>
            <span>MONSTER RECORD · {monster.name.toUpperCase()}</span>
          </div>
          </div>
          <div className="record-health-rail ones" aria-label="Health units">{Array.from({ length: 10 }, (_, value) => <span key={value} className={monster.health % 10 === value ? "health-marker" : ""}>{value}</span>)}<small>HEALTH</small></div>
        </div>
        <details className="monster-current-values"><summary>Current game values · {monster.health} Health · {monster.infamy} Infamy</summary>
          <SheetStats values={{ Health: `${monster.health} / ${monster.maxHealth}`, Infamy: monster.infamy, Move: monster.move, Movement: movementLabel(monster.movement), Attacks: monster.attacks, Defense: monster.defense, Damage: monster.damage }} />
          <p>Mutation cards and combat conditions can change the printed values.</p>
        </details>
        {definition && <SourcePhoto file={definition.sourceRefs[0].split("/").at(-1)!} />}
      </div>
        <SheetCards game={game} playerIndex={playerIndex} kind="mutation" canAct={canAct} runCommand={runCommand} />
      </div>
    </div>
  </div>;
}

export function PlayerStatusControls({ game, monster, branch, playerIndex, canAct, runCommand, onDeploy, onSelectDeployment }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const playCard = (command: GameCommand) => { setOpen(null); return runCommand(command); };
  return <>
    <nav className="player-sheet-peeks" aria-label={`Player ${playerIndex + 1} reference sheets`}>
      {[{ id: "monster", name: monster.name, kind: "Monster", theme: "monster", count: game.players[playerIndex]?.mutationCardIds.length ?? 0 },
        ...ownedMilitarySheets(game, playerIndex, branch).map((name) => ({ id: name, name, kind: "Military", theme: name, count: name === branch ? game.players[playerIndex]?.researchCardIds.length ?? 0 : undefined })),
      ].map((sheet) => <button key={sheet.id} className="sheet-peek" data-sheet={sheet.theme} aria-label={`Open ${sheet.name} ${sheet.kind.toLowerCase()} sheet`} aria-haspopup="dialog" onClick={() => setOpen(sheet.id)}>
        <span className="sheet-peek-title">{sheet.name}</span>
        <small>{sheet.kind} sheet{sheet.count ? ` · ${sheet.count} cards` : ""}</small>
        <span className="sheet-peek-invite" aria-hidden="true">Open sheet ↗</span>
      </button>)}
    </nav>
    {open && createPortal(open === "monster"
      ? <MonsterSheet monster={monster} game={game} playerIndex={playerIndex} canAct={canAct} runCommand={playCard} onClose={() => setOpen(null)} />
      : <MilitarySheet key={open} initialSheet={open} playerIndex={playerIndex} canAct={canAct} runCommand={playCard} onDeploy={(sheet) => { setOpen(null); onDeploy(sheet); }} branch={branch} game={game} choices={[]} referenceOnly onSelect={(choice) => { setOpen(null); onSelectDeployment?.(choice); }} onClose={() => setOpen(null)} />, document.body)}
  </>;
}

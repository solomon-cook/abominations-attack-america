import { ownedMilitarySheets } from "./owned-sheets";
import { MutationStrip } from "./MutationStrip";
import { SheetCards } from "./SheetCards";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MONSTER_DEFINITIONS, UNIT_DEFINITIONS, type GameCommand, type GameState } from "@abominations/game-engine";
import { MilitarySheet, type DeploymentChoice } from "./MilitarySheet";
import { monsterAssetSlug } from "../monster-assets";
import { movementLabel, SheetStats } from "./SheetReference";

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
                <img className="monster-record-portrait" src={`/assets/monsters/portraits/${monsterAssetSlug(monster.name)}.webp`} alt={`${monster.name} portrait`} />
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
      </div>
        <SheetCards game={game} playerIndex={playerIndex} kind="mutation" canAct={canAct} runCommand={runCommand} />
      </div>
    </div>
  </div>;
}

export function PlayerStatusControls({ game, monster, branch, playerIndex, canAct, runCommand, onDeploy, onSelectDeployment }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"monster" | "military" | "map">("monster");
  const [mobileRecordOpen, setMobileRecordOpen] = useState(false);
  const roster = UNIT_DEFINITIONS.filter(unit => unit.branch === branch);
  const available = game.units.filter(unit => unit.ownerPlayer === playerIndex && !game.removedUnitIds.includes(unit.id) && unit.location !== "permanently-removed");
  const playCard = (command: GameCommand) => { setOpen(null); return runCommand(command); };
  return <>
    <section className={`persistent-record ${mobileRecordOpen ? "mobile-record-open" : "mobile-record-closed"}`} data-record-tab={tab} aria-label="Player record and map">
      <button
        type="button"
        className="mobile-record-toggle"
        aria-expanded={mobileRecordOpen}
        aria-controls="record-panel"
        aria-label={mobileRecordOpen ? "Minimize monster, military and map record" : "Open monster, military and map record"}
        onClick={() => setMobileRecordOpen((current) => !current)}
      >
        <span aria-hidden="true">{mobileRecordOpen ? "×" : "☰"}</span>
        <small>{mobileRecordOpen ? "Hide" : "Records"}</small>
      </button>
      <div className="record-tabs" role="tablist" aria-label="Record view">{(["monster", "military", "map"] as const).map(view => <button key={view} role="tab" id={`record-tab-${view}`} aria-selected={tab === view} aria-controls="record-panel" tabIndex={tab === view ? 0 : -1} onClick={() => setTab(view)} onKeyDown={event => {
        const views = ["monster", "military", "map"] as const;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = views[(views.indexOf(view) + (event.key === "ArrowRight" ? 1 : 2)) % 3]; setTab(next); document.getElementById(`record-tab-${next}`)?.focus(); }
      }}>{view === "monster" ? "Monster" : view === "military" ? "Military" : "Map"}</button>)}</div>
      <div id="record-panel" role="tabpanel" aria-labelledby={`record-tab-${tab}`}>
        {tab === "monster" && <button className="record-preview" onClick={() => setOpen("monster")} aria-label={`Open ${monster.name} monster sheet`}>
          <img src={`/assets/monsters/portraits/${monsterAssetSlug(monster.name)}.webp`} alt="" />
          <span className="record-preview-body"><small>PLAYER {playerIndex + 1} · MONSTER RECORD</small><strong>{monster.name}</strong>
            <span>Health <b>{monster.health}/{monster.maxHealth}</b> · ★ {monster.infamy} Infamy</span>
            <meter min={0} max={monster.maxHealth} value={monster.health} aria-label="Monster health" />
            <span className="record-mini-stats">Move <b>{monster.move}</b> · Attacks <b>{monster.attacks}</b> · Defense <b>{monster.defense}</b> · Damage <b>{monster.damage}</b></span>
            <small>Open full sheet ↗</small>
          </span>
        </button>}
        {tab === "monster" && <MutationStrip cards={game.players[playerIndex]?.mutationCardIds ?? []} />}
        {tab === "military" && <button className="record-preview military-record-preview" onClick={() => setOpen(branch)} aria-label={`Open ${branch} military sheet`}>
          <img src={`/assets/military/${roster[0]?.id ?? "army-tank"}.webp`} alt="" />
          <span className="record-preview-body"><small>PLAYER {playerIndex + 1} · MILITARY RECORD</small><strong>{branch}</strong>
            <span>{available.filter(unit => unit.location !== "record-tile").length} deployed · {available.filter(unit => unit.location === "record-tile").length} reserve</span>
            <span>{game.players[playerIndex]?.researchCardIds.length ?? 0} Research cards</span>
            <span className="record-mini-stats">{roster.map(unit => `${unit.name} · Move ${unit.move}`).join(" / ")}</span><small>Open full sheet ↗</small>
          </span>
        </button>}
        {tab === "map" && <span className="record-map-space" aria-label="Map overview below" />}
      </div>
    </section>
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

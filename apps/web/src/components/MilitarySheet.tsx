import { ownedMilitarySheets } from "./owned-sheets";
import { SheetCards } from "./SheetCards";
import { MilitaryReference, movementLabel } from "./SheetReference";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { MoveUpRight, Shield, Sword } from "lucide-react";
import { deploymentChoices, GIANT_UNIT_DEFINITIONS, legalGiantPlacementDestinations, militaryUnitStats, NATIONAL_GUARD_DEFINITIONS, UNIT_DEFINITIONS, type DeploymentChoice, type GameCommand, type GameState } from "@abominations/game-engine";
export { deploymentChoices, type DeploymentChoice } from "@abominations/game-engine";

/** Prefer the branch until its legal allowance is exhausted, then eligible Guard. */
export function nextDeploymentSheet(choices: readonly DeploymentChoice[], branch: string): string {
  return choices.some((choice) => choice.sheet === branch) ? branch
    : choices.some((choice) => choice.sheet === "National Guard") ? "National Guard"
    : choices[0]?.sheet ?? branch;
}

const displayCurrentValue = (value: number | readonly [number, number] | undefined) => value === undefined
  ? "—"
  : typeof value === "number" ? String(value) : String(value[0]);
const compactMovementLabel = (value: string | undefined) => ({ "land-only": "Land only", "land-lake": "Land/lake", "land-lake-sea": "Land/sea", "sea-seacoast-only": "Sea/coast", "sea-seacoast-or-fly": "Sea/fly", fly: "Fly", stationary: "Stationary" })[value ?? ""] ?? movementLabel(value ?? "Movement");
const highDensityMilitaryArt = new Set([
  "army-tank",
  "air-force-fighter",
  "marines-fighter",
  "marines-rocket-launcher",
  "navy-fighter",
  "navy-nuclear-submarine",
]);

function compactUnitSummary(typeId: string, sheet: string, game: GameState, playerIndex: number) {
  const unitDefinition = UNIT_DEFINITIONS.find((unit) => unit.id === typeId);
  const guardDefinition = NATIONAL_GUARD_DEFINITIONS.find((unit) => unit.id === typeId);
  const giantDefinition = GIANT_UNIT_DEFINITIONS.find((unit) => unit.id === typeId);
  const instance = game.units.find((unit) => (unit.unitTypeId ?? unit.branch) === typeId && !game.removedUnitIds.includes(unit.id)
    && (unit.ownerPlayer === playerIndex || unit.ownerPlayer === undefined));
  const live = instance ? militaryUnitStats(game, instance) : undefined;
  const guardCommander = game.players[playerIndex]?.researchCardIds.includes("Guard Commander") ?? false;
  const move = guardDefinition
    ? guardCommander ? live?.move ?? guardDefinition.move : guardDefinition.printedMove
    : live?.move ?? unitDefinition?.move ?? giantDefinition?.move;
  const movement = guardDefinition
    ? guardCommander ? guardDefinition.name === "Fighter" ? "fly" : "land-only" : "stationary"
    : instance?.movement ?? unitDefinition?.movement ?? giantDefinition?.movement;
  const attacks = instance?.attacks ?? unitDefinition?.attacks ?? (guardDefinition ? 1 : giantDefinition?.attacks);
  const damage = unitDefinition?.damage ?? instance?.damage ?? guardDefinition?.damage ?? giantDefinition?.damage;
  const defense = unitDefinition?.defense ?? instance?.defense ?? guardDefinition?.defense ?? giantDefinition?.defense;
  const specialAbility = typeId === "navy-nuclear-submarine"
    ? "During Move, launch a nuclear missile up to 8 spaces. It can be intercepted, then rolls against the monster’s Defense for 3 damage. A 6 adds a smash point; a 1 triggers Mutation."
    : guardDefinition
      ? undefined
      : unitDefinition?.specialAbilityText ?? (typeId === "x-fighter" ? "Deploy in place of a branch unit." : undefined);
  const name = unitDefinition?.name ?? guardDefinition?.name ?? giantDefinition?.name ?? typeId.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const reserve = typeId.startsWith("national-guard-")
    ? game.nationalGuard.unitIds.filter((id) => id.startsWith(`${typeId}-`) && !game.removedUnitIds.includes(id) && !game.units.some((unit) => unit.id === id)).length
    : game.units.filter((unit) => (unit.unitTypeId ?? unit.branch) === typeId && unit.location === "record-tile" && !game.removedUnitIds.includes(unit.id)
      && (unit.ownerPlayer === playerIndex || unit.ownerPlayer === undefined)).length;

  return {
    name,
    sheet,
    reserve,
    movement: move === undefined ? "—" : move === 0 ? "You can’t move this" : `${move} · ${compactMovementLabel(movement)}`,
    movementUnavailable: move === 0,
    attack: attacks === undefined ? "—" : attacks > 1 ? `${attacks} × ${displayCurrentValue(damage)}` : displayCurrentValue(damage),
    defence: displayCurrentValue(defense),
    specialAbility,
  };
}

function compactAbilitySummary(text: string): string {
  if (text.startsWith("During Move, launch a nuclear missile")) {
    return "Nuclear missile · range 8";
  }
  if (text.startsWith("Makes an extra attack during the first round of combat")) {
    return "Round 1 extra attack";
  }
  if (text.startsWith("Destroyed after the first round of combat")) {
    return "Roll 1: mutates monster";
  }
  return text;
}

function CompactUnitCard({ typeId, summary, actionLabel, onSelect, abilityExpanded, onToggleAbility }: { typeId: string; summary: ReturnType<typeof compactUnitSummary>; actionLabel: string; onSelect?: () => void; abilityExpanded?: boolean; onToggleAbility?: () => void }) {
  const researchGiant = summary.sheet === "Giant · Research";
  const imagePath = `/assets/military/${typeId}.webp`;
  const imageSrcSet = highDensityMilitaryArt.has(typeId) ? `/assets/military/retina/${typeId}.webp 2x` : undefined;
  const reserveLabel = researchGiant ? "1 available from Research" : `${summary.reserve} in reserve`;
  const sheetPrefix = summary.sheet && !researchGiant ? `${summary.sheet} ` : "";
  const selection = researchGiant ? `one Research card available` : `${summary.reserve} in reserve`;
  const ariaLabel = `Select ${sheetPrefix}${summary.name} to ${actionLabel.toLowerCase()}; ${selection}. Attack ${summary.attack}. Defence ${summary.defence}. Movement ${summary.movement}.${summary.specialAbility ? ` Special ability: ${summary.specialAbility}` : ""}`;
  const cardContents = <>
    <div className="compact-deployment-visual" aria-hidden={onSelect ? true : undefined}>
      <div className="compact-deployment-header">
        <span className="compact-deployment-heading"><span><strong>{summary.name}</strong>{summary.sheet && !(summary.sheet === "National Guard" && summary.movementUnavailable) && <small>{summary.sheet}</small>}</span></span>
        <span className="compact-deployment-count" aria-label={reserveLabel}><b>{summary.reserve}</b><small>LEFT</small></span>
      </div>
      <span className={`compact-deployment-art${typeId.includes("nuclear-submarine") || typeId.includes("cruise-missile") ? " compact-deployment-art-tall" : ""}`}><img src={imagePath} srcSet={imageSrcSet} alt="" /></span>
      <span className="compact-deployment-stats" aria-label="Unit statistics">
        <span className="compact-stat compact-stat-attack"><span className="compact-stat-value"><Sword size={16} strokeWidth={1.6} aria-hidden="true" /><b>{summary.attack}</b></span><small className="sr-only">Attack</small></span>
        <span className={`compact-stat compact-stat-movement${summary.movementUnavailable ? " compact-stat-movement-static" : ""}`}><small className="sr-only">Movement</small><span className="compact-stat-value">{!summary.movementUnavailable && <MoveUpRight className="compact-movement-icon" size={16} strokeWidth={1.6} aria-hidden="true" />}<b>{summary.movement}</b></span></span>
        <span className="compact-stat compact-stat-defence"><span className="compact-stat-value"><Shield size={16} strokeWidth={1.6} aria-hidden="true" /><b>{summary.defence}</b></span><small className="sr-only">Defence</small></span>
      </span>
    </div>
    {onSelect && <button className="compact-deployment-select" type="button" onClick={onSelect} aria-label={ariaLabel} />}
    {summary.specialAbility
      ? <div className="compact-stat-ability"><button className="compact-stat-ability-toggle" type="button" aria-expanded={abilityExpanded} onClick={onToggleAbility} aria-label={`${abilityExpanded ? "Hide" : "Show"} special ability details for ${summary.name}`}><span>{compactAbilitySummary(summary.specialAbility)}</span><small aria-hidden="true">{abilityExpanded ? "−" : "+"}</small></button></div>
      : !onSelect && <span className="compact-deployment-action-hint">No legal location</span>}
    <span className="compact-deployment-footer-seal" aria-hidden="true">
      <svg viewBox="0 0 24 20"><path d="M2 18c6-2 11-7 17-15M5 15c-3-3-2-5 2-6 2 2 1 4-2 6Zm5-4c-2-3 0-5 4-5 1 3-1 5-4 5Zm4-4c-1-3 1-5 4-5 1 3-1 5-4 5Z" /></svg>
      <b>★</b>
      <svg className="compact-footer-sprig-reverse" viewBox="0 0 24 20"><path d="M2 18c6-2 11-7 17-15M5 15c-3-3-2-5 2-6 2 2 1 4-2 6Zm5-4c-2-3 0-5 4-5 1 3-1 5-4 5Zm4-4c-1-3 1-5 4-5 1 3-1 5-4 5Z" /></svg>
    </span>
  </>;
  return <div className={`compact-deployment-card${onSelect ? " compact-deployment-card-selectable" : " compact-deployment-unavailable-card"}`}>{cardContents}</div>;
}

export function CompactDeploymentList({ branch, choices, game, playerIndex, onSelect, onChooseGiant }: { branch: string; choices: readonly DeploymentChoice[]; game: GameState; playerIndex: number; onSelect: (choice: DeploymentChoice) => void; onChooseGiant?: (cardId: "Mecha-Monster" | "Captain Colossal") => void }) {
  const [expandedAbilityTypeId, setExpandedAbilityTypeId] = useState<string | null>(null);
  const groups = new Map<string, { deploy: DeploymentChoice[]; redeploy: DeploymentChoice[]; sheet: string }>();
  for (const choice of choices) {
    const group = groups.get(choice.typeId) ?? { deploy: [], redeploy: [], sheet: choice.sheet };
    group[choice.kind].push(choice);
    groups.set(choice.typeId, group);
  }
  const typeIds = new Set<string>(UNIT_DEFINITIONS.filter((unit) => unit.branch === branch).map((unit) => unit.id));
  for (const choice of choices) typeIds.add(choice.typeId);
  const giantCards = game.phase === "deploy" && game.pendingDecision?.type === "deployment" && onChooseGiant
    ? GIANT_UNIT_DEFINITIONS.filter((unit) => game.players[playerIndex]?.researchCardIds.includes(unit.name)
      && !game.units.some((piece) => piece.unitTypeId === unit.id && piece.location !== "permanently-removed")
      && legalGiantPlacementDestinations(game).length > 0)
    : [];
  const items = [...typeIds].map((typeId) => {
    const group = groups.get(typeId) ?? { deploy: [], redeploy: [], sheet: branch };
    return { typeId, group, summary: compactUnitSummary(typeId, group.sheet, game, playerIndex) };
  });
  const giantItems = giantCards.map((unit) => ({ unit, summary: {
    ...compactUnitSummary(unit.id, "Giant", game, playerIndex),
    name: unit.name,
    reserve: 1,
  } }));
  const deploymentItems = [
    ...items.map((item) => ({ kind: "unit" as const, ...item, canRedeploy: Boolean(item.group.deploy[0] && item.group.redeploy[0]) })),
    ...giantItems.map((item) => ({ kind: "giant" as const, ...item, canRedeploy: false })),
  ];

  return <div className="compact-deployment-list" aria-label="Available military unit types">
    {deploymentItems.map((item, index) => {
      const pairedItem = deploymentItems[index % 2 === 0 ? index + 1 : index - 1];
      const reserveRedeploySlot = !item.canRedeploy && Boolean(pairedItem?.canRedeploy);
      const itemKey = item.kind === "unit" ? item.typeId : item.unit.id;
      const abilityExpanded = item.kind === "unit" && expandedAbilityTypeId === item.typeId;
      const unitCard = item.kind === "unit"
        ? <CompactUnitCard typeId={item.typeId} summary={{ ...item.summary, sheet: item.summary.sheet === branch ? "" : item.summary.sheet }} actionLabel={item.group.deploy[0] ? "Deploy" : "Redeploy"} abilityExpanded={abilityExpanded} onToggleAbility={() => setExpandedAbilityTypeId(abilityExpanded ? null : item.typeId)} onSelect={item.group.deploy[0] || item.group.redeploy[0] ? () => onSelect(item.group.deploy[0] ?? item.group.redeploy[0]!) : undefined} />
        : <CompactUnitCard typeId={item.unit.id} summary={{ ...item.summary, sheet: "Giant · Research" }} actionLabel="Place" onSelect={() => onChooseGiant?.(item.unit.name)} />;
      const expandedAbilityIndex = deploymentItems.findIndex((candidate) => candidate.kind === "unit" && candidate.typeId === expandedAbilityTypeId);
      const rowLastIndex = Math.min(Math.floor(index / 2) * 2 + 1, deploymentItems.length - 1);
      const showAbilityDetail = expandedAbilityTypeId !== null
        && expandedAbilityIndex >= 0
        && Math.floor(expandedAbilityIndex / 2) === Math.floor(index / 2)
        && index === rowLastIndex;
      const expandedAbility = expandedAbilityIndex >= 0 && deploymentItems[expandedAbilityIndex]?.kind === "unit"
        ? deploymentItems[expandedAbilityIndex]
        : undefined;
      return <Fragment key={itemKey}>
        <div className={`compact-deployment-option ${item.summary.reserve === 0 ? "compact-deployment-card-empty" : ""}`}>
          {unitCard}
          {item.canRedeploy && item.kind === "unit"
            ? <button type="button" className="compact-redeploy-link" onClick={() => onSelect(item.group.redeploy[0]!)} aria-label={`Redeploy ${item.summary.name} already on the map`}>Redeploy existing</button>
            : reserveRedeploySlot && <span className="compact-redeploy-slot" aria-hidden="true" />}
        </div>
        {showAbilityDetail && expandedAbility?.kind === "unit" && expandedAbility.summary.specialAbility && <section className="compact-ability-detail" style={{ "--ability-origin": expandedAbilityIndex % 2 === 0 ? "25%" : "75%" } as CSSProperties} aria-live="polite">
          <h3>{expandedAbility.summary.name} <span>Special ability</span></h3>
          <p>{expandedAbility.summary.specialAbility}</p>
        </section>}
      </Fragment>;
    })}
    {!choices.length && <p className="compact-deployment-empty">No legal placements remain. Deployment will continue automatically.</p>}
  </div>;
}

export function MilitarySheet({ branch, choices, onSelect, onChooseGiant, onClose, game, referenceOnly = false, allowPieceSelection = true, canAct = false, runCommand, playerIndex = game?.currentPlayer ?? 0, onDeploy, initialSheet }: { branch: string; choices: DeploymentChoice[]; onSelect: (choice: DeploymentChoice) => void; onChooseGiant?: (cardId: "Mecha-Monster" | "Captain Colossal") => void; onClose: () => void; game?: GameState; referenceOnly?: boolean; allowPieceSelection?: boolean; canAct?: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; playerIndex?: number; onDeploy?: (sheet?: string) => void; initialSheet?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const drawerDrag = useRef<{ y: number; height: number } | null>(null);
  const suppressSelection = useRef(false);
  const [section, setSection] = useState<"units" | "research">("units");
  const [selectedSheet, setSelectedSheet] = useState(initialSheet ?? nextDeploymentSheet(choices, branch));
  const [compactDeployment, setCompactDeployment] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const extraSheets = game ? ownedMilitarySheets(game, playerIndex, branch) : [];
  const sheets = [branch, ...new Set([...choices.map((choice) => choice.sheet), ...extraSheets].filter((sheet) => sheet !== branch))];
  const activeSheet = sheets.includes(selectedSheet) ? selectedSheet : branch;
  const pageIndex = sheets.indexOf(activeSheet);
  const interactiveChoices = referenceOnly && allowPieceSelection && game && canAct && playerIndex === game.currentPlayer ? deploymentChoices(game) : choices;
  const pageChoices = interactiveChoices.filter((choice) => choice.sheet === activeSheet);
  const turnPage = (direction: number) => setSelectedSheet(sheets[(pageIndex + direction + sheets.length) % sheets.length]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setCompactDeployment(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const drawerBounds = () => ({ min: 96, max: Math.max(260, window.innerHeight - 54) });
  const resizeDrawer = (height: number) => {
    const { min, max } = drawerBounds();
    setDrawerHeight(Math.min(max, Math.max(min, height)));
  };
  const drawerStyle = compactDeployment && drawerHeight ? { "--mobile-drawer-height": `${drawerHeight}px` } as CSSProperties : undefined;
  return <div className="military-drawer-layer">
    <div className={`military-hand military-drawer ${drawerHeight ? "military-drawer-resized" : ""}`} style={drawerStyle} ref={ref} role="dialog" aria-labelledby="military-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (referenceOnly && !(event.target instanceof HTMLSelectElement) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); }

    }}>
      <div className="military-drawer-grab" role="slider" tabIndex={0} aria-label="Resize military sheet" aria-orientation="vertical" aria-valuemin={96} aria-valuemax={Math.max(260, typeof window === "undefined" ? 800 : window.innerHeight - 54)} aria-valuenow={Math.round(drawerHeight ?? window.innerHeight * .58)} onPointerDown={(event) => {
        if (!compactDeployment) return;
        drawerDrag.current = { y: event.clientY, height: ref.current?.getBoundingClientRect().height ?? window.innerHeight * .58 };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!drawerDrag.current) return;
        resizeDrawer(drawerDrag.current.height + drawerDrag.current.y - event.clientY);
      }} onPointerUp={(event) => {
        drawerDrag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { drawerDrag.current = null; }} onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const { min, max } = drawerBounds();
        resizeDrawer(event.key === "Home" ? min : event.key === "End" ? max : (drawerHeight ?? window.innerHeight * .58) + (event.key === "ArrowUp" ? 48 : -48));
      }}><span /></div>
      <div className="military-hand-toolbar">
        <span className="label">MILITARY</span>
        <button className="military-sheet-close" onClick={onClose} aria-label="Close military sheets"><span className="mobile-close-label">Close</span><span className="desktop-close-label">Tuck away →</span></button>
      </div>
      <nav className="military-section-nav" aria-label="Military actions">
        <button type="button" aria-pressed={section === "units"} onClick={() => setSection("units")}>Unit deployment</button>
        {game && <button type="button" aria-pressed={section === "research"} onClick={() => setSection("research")}>Military research <span>{game.players[playerIndex]?.researchCardIds.length ?? 0}</span></button>}
      </nav>
      {section === "units" && referenceOnly && sheets.length > 1 && <nav className="military-sheet-tabs" aria-label="Military sheets">
        {sheets.map((sheet) => <button key={sheet} aria-pressed={sheet === activeSheet} onClick={() => setSelectedSheet(sheet)}>{sheet}</button>)}
      </nav>}
      <div className={`military-sheet ${referenceOnly ? "physical-military-sheet" : "digital-deployment-sheet"}`} data-branch={activeSheet} key={activeSheet} onTouchStart={(event) => {
        suppressSelection.current = false;
        const touch = event.touches[0];
        touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
      }} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!referenceOnly || !start || sheets.length < 2) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          suppressSelection.current = true;
          turnPage(dx < 0 ? 1 : -1);
        }
      }} onClickCapture={(event) => {
        if (suppressSelection.current) { event.preventDefault(); event.stopPropagation(); suppressSelection.current = false; }
      }}>
        {referenceOnly && <span className="label">MILITARY RECORD SHEET</span>}
        <h2 id="military-sheet-title">{referenceOnly ? activeSheet : "Deploy units"}</h2>
        {section === "units" && <>
        {!referenceOnly && game
          ? <>
              <p className="deployment-instruction">Select a unit; its available spaces glow.</p>
              <CompactDeploymentList branch={branch} choices={interactiveChoices} game={game} playerIndex={playerIndex} onSelect={onSelect} onChooseGiant={onChooseGiant} />
            </>
          : <>
              {pageChoices.length > 0 && <p className="deployment-instruction">Select a piece, then a glowing location on the map.</p>}
              <MilitaryReference choices={pageChoices} onSelect={onSelect} sheet={activeSheet} game={game && playerIndex !== game.currentPlayer ? { ...game, currentPlayer: playerIndex } : game} />
            </>}
        </>}
        {section === "research" && game && <div className="military-drawer-research">
          {game.phase === "deploy" && <div className="military-research-turn-action">
            <button className="military-research-draw-choice" type="button" aria-label="Draw a Military Research card instead of deploying a unit" disabled={!canAct || playerIndex !== game.currentPlayer || game.deploymentsThisTurn > 0 || game.decks.research.exhausted || choices.length === 0} onClick={() => void runCommand?.({ type: "draw-research" })}>
              <span className="military-research-draw-icon" aria-hidden="true">▤</span>
              <span className="military-research-draw-copy"><strong>Draw a research card</strong><small>Use this turn’s military action instead of deploying.</small></span>
              <span className="military-research-draw-arrow" aria-hidden="true">→</span>
            </button>
            {game.deploymentsThisTurn > 0 && <small>A unit has already deployed this turn.</small>}
            {game.decks.research.exhausted && <small>The Military Research deck is empty.</small>}
            {!choices.length && <small>No legal deployment or research action is available.</small>}
          </div>}
          <SheetCards game={game} playerIndex={playerIndex} kind="research" canAct={canAct} runCommand={runCommand} onDeploy={onDeploy ?? ((sheet) => { if (sheet) setSelectedSheet(sheet); setSection("units"); })} />
        </div>}
      </div>

    </div>
  </div>;
}

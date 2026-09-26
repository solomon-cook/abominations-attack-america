import { ownedMilitarySheets } from "./owned-sheets";
import { SheetCards } from "./SheetCards";
import { MilitaryReference } from "./SheetReference";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { deployUnitResult, redeployUnitResult, legalOwnedDeploymentDestinations, legalOwnedRedeploymentDestinations, legalNationalGuardDeploymentDestinations, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";

export type DeploymentChoice = { id: string; typeId: string; sheet: string; kind: "deploy" | "redeploy"; destinations: HexKey[] };

export function deploymentChoices(game: GameState): DeploymentChoice[] {
  if (game.phase !== "deploy") return [];
  const candidates = [
    ...game.units.filter((unit) => !game.removedUnitIds.includes(unit.id)).map((unit) => ({ id: unit.id, typeId: unit.unitTypeId ?? unit.branch, sheet: unit.unitTypeId === "x-fighter" ? "X-Fighters" : unit.branch, kind: unit.location === "record-tile" ? "deploy" as const : "redeploy" as const })),
    ...game.nationalGuard.unitIds.filter((id) => !game.units.some((unit) => unit.id === id) && !game.removedUnitIds.includes(id)).map((id) => ({ id, typeId: id.replace(/-\d+$/, ""), sheet: "National Guard", kind: "deploy" as const })),
  ];
  return candidates.flatMap((choice) => {
    const destinations = choice.kind === "redeploy" ? legalOwnedRedeploymentDestinations(game, choice.id)
      : choice.id.startsWith("national-guard-") ? legalNationalGuardDeploymentDestinations(game) : legalOwnedDeploymentDestinations(game);
    if (!destinations.length) return [];
    // Validate against the same rules as the submitted action, including research allowances.
    try {
      const resolve = choice.kind === "deploy" ? deployUnitResult : redeployUnitResult;
      const result = resolve(game, { unitId: choice.id, destination: destinations[0] });
      if (result.unitId !== choice.id) return [];
      return [{ ...choice, destinations }];
    } catch { return []; }
  });
}

/** Prefer the branch until its legal allowance is exhausted, then eligible Guard. */
export function nextDeploymentSheet(choices: readonly DeploymentChoice[], branch: string): string {
  return choices.some((choice) => choice.sheet === branch) ? branch
    : choices.some((choice) => choice.sheet === "National Guard") ? "National Guard"
    : choices[0]?.sheet ?? branch;
}

export function MilitarySheet({ branch, choices, onSelect, onClose, game, referenceOnly = false, canAct = false, runCommand, playerIndex = game?.currentPlayer ?? 0, onDeploy, initialSheet }: { branch: string; choices: DeploymentChoice[]; onSelect: (choice: DeploymentChoice) => void; onClose: () => void; game?: GameState; referenceOnly?: boolean; canAct?: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; playerIndex?: number; onDeploy?: (sheet?: string) => void; initialSheet?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const drawerDrag = useRef<{ y: number; height: number } | null>(null);
  const suppressSelection = useRef(false);
  const [section, setSection] = useState<"units" | "research">("units");
  const [selectedSheet, setSelectedSheet] = useState(initialSheet ?? nextDeploymentSheet(choices, branch));
  const [compactDeployment, setCompactDeployment] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const extraSheets = game ? ownedMilitarySheets(game, playerIndex, branch) : [];
  const sheets = [branch, ...new Set([...choices.map((choice) => choice.sheet), ...extraSheets].filter((sheet) => sheet !== branch))];
  const activeSheet = sheets.includes(selectedSheet) ? selectedSheet : branch;
  const pageIndex = sheets.indexOf(activeSheet);
  const interactiveChoices = referenceOnly && game && canAct && playerIndex === game.currentPlayer ? deploymentChoices(game) : choices;
  const pageChoices = interactiveChoices.filter((choice) => choice.sheet === activeSheet);
  const turnPage = (direction: number) => setSelectedSheet(sheets[(pageIndex + direction + sheets.length) % sheets.length]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
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
      if (!(event.target instanceof HTMLSelectElement) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); }

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
      {section === "units" && sheets.length > 1 && <nav className="military-sheet-tabs" aria-label="Military sheets">
        {sheets.map((sheet) => <button key={sheet} aria-pressed={sheet === activeSheet} onClick={() => setSelectedSheet(sheet)}>{sheet}</button>)}
      </nav>}
      <div className="military-sheet physical-military-sheet" data-branch={activeSheet} key={activeSheet} onTouchStart={(event) => {
        suppressSelection.current = false;
        const touch = event.touches[0];
        touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
      }} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || sheets.length < 2) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          suppressSelection.current = true;
          turnPage(dx < 0 ? 1 : -1);
        }
      }} onClickCapture={(event) => {
        if (suppressSelection.current) { event.preventDefault(); event.stopPropagation(); suppressSelection.current = false; }
      }}>
        <span className="label">MILITARY RECORD SHEET</span>
        <h2 id="military-sheet-title">{activeSheet}</h2>
        {section === "units" && <>
        {pageChoices.length > 0 && <p className="deployment-instruction">Select a piece, then a glowing location on the map.</p>}
        <MilitaryReference choices={pageChoices} onSelect={onSelect} sheet={activeSheet} game={game && playerIndex !== game.currentPlayer ? { ...game, currentPlayer: playerIndex } : game} />
        {!referenceOnly && !pageChoices.length && <p>No pieces on this sheet can be deployed.{sheets.length > 1 ? " Switch to another military sheet." : " No legal placements remain. Deployment will continue automatically."}</p>}
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

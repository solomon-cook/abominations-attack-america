import { ownedMilitarySheets } from "./owned-sheets";
import { SheetCards } from "./SheetCards";
import { MilitaryReference } from "./SheetReference";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { deploymentChoices, type DeploymentChoice, type GameCommand, type GameState } from "@abominations/game-engine";
export { deploymentChoices, type DeploymentChoice } from "@abominations/game-engine";

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
  const focusSelectedSheet = useRef(false);
  const [section, setSection] = useState<"units" | "research">("units");
  const [selectedSheet, setSelectedSheet] = useState(initialSheet ?? nextDeploymentSheet(choices, branch));
  const [compactDeployment, setCompactDeployment] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const extraSheets = game ? ownedMilitarySheets(game, playerIndex, branch) : [];
  const sheets = [branch, ...new Set([...choices.map((choice) => choice.sheet), ...extraSheets].filter((sheet) => sheet !== branch))];
  const activeSheet = sheets.includes(selectedSheet) ? selectedSheet : branch;
  const pageIndex = sheets.indexOf(activeSheet);
  useEffect(() => {
    if (!focusSelectedSheet.current) return;
    focusSelectedSheet.current = false;
    ref.current?.querySelector<HTMLButtonElement>(".military-sheet-tabs button[aria-pressed='true']")?.focus();
  }, [activeSheet]);
  const interactiveChoices = referenceOnly && game && canAct && playerIndex === game.currentPlayer ? deploymentChoices(game) : choices;
  const pageChoices = interactiveChoices.filter((choice) => choice.sheet === activeSheet);
  const turnPage = (direction: number) => setSelectedSheet(sheets[(pageIndex + direction + sheets.length) % sheets.length]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => window.removeEventListener("keydown", dismissOnEscape, true);
  }, [onClose]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => setCompactDeployment(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const drawerBounds = () => ({ min: 96, max: Math.max(96, window.innerHeight - 54) });
  const resizeDrawer = (height: number) => {
    const { min, max } = drawerBounds();
    setDrawerHeight(Math.min(max, Math.max(min, height)));
  };
  useEffect(() => {
    const reclamp = () => setDrawerHeight((height) => {
      if (height === null) return height;
      const { min, max } = drawerBounds();
      return Math.min(max, Math.max(min, height));
    });
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);
  const drawerStyle = compactDeployment && drawerHeight ? { "--mobile-drawer-height": `${drawerHeight}px` } as CSSProperties : undefined;
  return <div className="military-drawer-layer">
    <div className={`military-hand military-drawer ${drawerHeight ? "military-drawer-resized" : ""}`} style={drawerStyle} ref={ref} role="dialog" aria-labelledby="military-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      const inSheetNavigation = event.target instanceof HTMLElement && Boolean(event.target.closest(".military-sheet-tabs"));
      if (inSheetNavigation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        focusSelectedSheet.current = true;
        turnPage(event.key === "ArrowRight" ? 1 : -1);
      }
    }}>
      <div className="military-drawer-grab" role="slider" tabIndex={0} aria-label="Resize military sheet" aria-orientation="vertical" aria-valuemin={96} aria-valuemax={drawerBounds().max} aria-valuenow={Math.round(drawerHeight ?? window.innerHeight * .58)} onPointerDown={(event) => {
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

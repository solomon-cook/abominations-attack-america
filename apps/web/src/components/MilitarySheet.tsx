import { ownedMilitarySheets } from "./owned-sheets";
import { SheetCards } from "./SheetCards";
import { MilitaryReference } from "./SheetReference";
import { useEffect, useRef, useState } from "react";
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

export function MilitarySheet({ branch, choices, onSelect, onClose, game, referenceOnly = false, canAct = false, runCommand, playerIndex = game?.currentPlayer ?? 0, onDeploy, initialSheet }: { branch: string; choices: DeploymentChoice[]; onSelect: (choice: DeploymentChoice) => void; onClose: () => void; game?: GameState; referenceOnly?: boolean; canAct?: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; playerIndex?: number; onDeploy?: (sheet?: string) => void; initialSheet?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressSelection = useRef(false);
  const [selectedSheet, setSelectedSheet] = useState(initialSheet ?? branch);
  const extraSheets = referenceOnly && game ? ownedMilitarySheets(game, playerIndex, branch) : [];
  const sheets = [branch, ...new Set([...choices.map((choice) => choice.sheet), ...extraSheets].filter((sheet) => sheet !== branch))];
  const activeSheet = sheets.includes(selectedSheet) ? selectedSheet : branch;
  const pageIndex = sheets.indexOf(activeSheet);
  const pageChoices = choices.filter((choice) => choice.sheet === activeSheet);
  const turnPage = (direction: number) => setSelectedSheet(sheets[(pageIndex + direction + sheets.length) % sheets.length]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="military-sheet-backdrop" onClick={onClose}>
    <div className={`military-hand ${sheets.length > 1 ? "multiple-sheets" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="military-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (!(event.target instanceof HTMLSelectElement) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); }
      if (event.key === "Tab") {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), summary, select:not(:disabled)") ?? []);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="military-hand-toolbar">
        <span className="label">YOUR MILITARY SHEETS</span>
        <button className="military-sheet-close" onClick={onClose}>Close</button>
      </div>
      {sheets.length > 1 && <nav className="military-sheet-tabs" aria-label="Military sheets">
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
        {!referenceOnly && <p>Choose a piece, then select a glowing location on the map.</p>}
        {referenceOnly && sheets.includes("National Guard") && (activeSheet === branch || activeSheet === "National Guard") && <div className="guard-sheet-action">
          {activeSheet !== "National Guard" && <button type="button" onClick={() => setSelectedSheet("National Guard")}>View National Guard sheet →</button>}
          {onDeploy && <button type="button" disabled={!canAct || !game || !deploymentChoices(game).some((choice) => choice.sheet === "National Guard")} onClick={() => onDeploy("National Guard")}>Deploy National Guard</button>}
          {game?.phase !== "deploy" && <small>Guard deployment is available during Deploy.</small>}
        </div>}
        {referenceOnly && game && <SheetCards game={game} playerIndex={playerIndex} kind="research" canAct={canAct} runCommand={runCommand} onDeploy={onDeploy} />}
        <MilitaryReference sheet={activeSheet} game={game && playerIndex !== game.currentPlayer ? { ...game, currentPlayer: playerIndex } : game} />
        {!referenceOnly && !pageChoices.length && <p>No pieces on this sheet can be deployed.{sheets.length > 1 ? " Switch to another military sheet." : " Draw Military Research or pass deployment."}</p>}
        {!referenceOnly && (["deploy", "redeploy"] as const).map((kind) => {
          const pieces = pageChoices.filter((choice) => choice.kind === kind);
          return pieces.length > 0 && <section key={kind} aria-label={kind === "deploy" ? "Reserve pieces" : "Deployed pieces"}>
            <h3>{kind === "deploy" ? "Reserve · deploy a piece" : "On the board · redeploy a piece"}</h3>
            <div className="military-sheet-pieces">{pieces.map((choice) => <button key={choice.id} onClick={() => onSelect(choice)} aria-label={`Select ${choice.typeId.replaceAll("-", " ")} ${choice.id}`}>
              <img src={`/assets/military/${choice.typeId}.webp`} alt="" />
              <strong>{choice.typeId.replaceAll("-", " ")}</strong>
              <small>{choice.destinations.length} available location{choice.destinations.length === 1 ? "" : "s"}</small>
            </button>)}</div>
          </section>;
        })}
        {!referenceOnly && game && <SheetCards game={game} playerIndex={playerIndex} kind="research" canAct={canAct} runCommand={runCommand} onDeploy={onDeploy} />}
      </div>
      {sheets.length > 1 && <div className="military-hand-navigation">
        <button onClick={() => turnPage(-1)} aria-label="Previous military sheet">← Previous</button>
        <span aria-live="polite">{pageIndex + 1} / {sheets.length} · Swipe to switch</span>
        <button onClick={() => turnPage(1)} aria-label="Next military sheet">Next →</button>
      </div>}
    </div>
  </div>;
}

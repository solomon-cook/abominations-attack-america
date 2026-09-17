import { useEffect, useRef } from "react";
import { deployUnitResult, redeployUnitResult, legalOwnedDeploymentDestinations, legalOwnedRedeploymentDestinations, legalNationalGuardDeploymentDestinations, type GameState, type HexKey } from "@abominations/game-engine";

export type DeploymentChoice = { id: string; typeId: string; kind: "deploy" | "redeploy"; destinations: HexKey[] };

export function deploymentChoices(game: GameState): DeploymentChoice[] {
  if (game.phase !== "deploy") return [];
  const candidates = [
    ...game.units.filter((unit) => !game.removedUnitIds.includes(unit.id)).map((unit) => ({ id: unit.id, typeId: unit.unitTypeId ?? unit.branch, kind: unit.location === "record-tile" ? "deploy" as const : "redeploy" as const })),
    ...game.nationalGuard.unitIds.filter((id) => !game.units.some((unit) => unit.id === id) && !game.removedUnitIds.includes(id)).map((id) => ({ id, typeId: id.replace(/-\d+$/, ""), kind: "deploy" as const })),
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

export function MilitarySheet({ branch, choices, onSelect, onClose }: { branch: string; choices: DeploymentChoice[]; onSelect: (choice: DeploymentChoice) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="military-sheet-backdrop" onClick={onClose}>
    <div className="military-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby="military-sheet-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button className="military-sheet-close" onClick={onClose}>Close</button>
      <span className="label">MILITARY RECORD SHEET</span>
      <h2 id="military-sheet-title">{branch}</h2>
      <p>Choose a piece, then select a glowing location on the map.</p>
      {!choices.length && <p>No pieces can be deployed. Draw Military Research or pass deployment.</p>}
      {(["deploy", "redeploy"] as const).map((kind) => {
        const pieces = choices.filter((choice) => choice.kind === kind);
        return pieces.length > 0 && <section key={kind} aria-label={kind === "deploy" ? "Reserve pieces" : "Deployed pieces"}>
          <h3>{kind === "deploy" ? "Reserve · deploy a piece" : "On the board · redeploy a piece"}</h3>
          <div className="military-sheet-pieces">{pieces.map((choice) => <button key={choice.id} onClick={() => onSelect(choice)} aria-label={`Select ${choice.typeId.replaceAll("-", " ")} ${choice.id}`}>
            <img src={`/assets/military/${choice.typeId}.webp`} alt="" />
            <strong>{choice.typeId.replaceAll("-", " ")}</strong>
            <small>{choice.destinations.length} available location{choice.destinations.length === 1 ? "" : "s"}</small>
          </button>)}</div>
        </section>;
      })}
    </div>
  </div>;
}

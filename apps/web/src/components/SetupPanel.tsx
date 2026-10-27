import { useEffect, useMemo, useState } from "react";
import { monsterDefinition, monsters, UNIT_DEFINITIONS, type BoardDefinition, type HexKey, type SetupPlacement, type SetupState } from "@abominations/game-engine";
import { setupLairLabel } from "./setup-location-label";
import type { RoomView } from "@abominations/shared";
import { monsterAssetSlug } from "../monster-assets";

type Props = {
  activeSetup: SetupState;
  board?: BoardDefinition;
  setupSeat?: SetupState["seats"][number];
  online: boolean;
  showSetupSummary?: boolean;
  playerIndex?: number;
  participants: RoomView["participants"];
  participantReady: boolean;
  canToggleReady: boolean;
  readinessPending: boolean;
  setupActionPending: boolean;
  onToggleReady: () => void;
  onChooseOption: (value: string) => void;
  onPlaceUnusedBranches: (placements: readonly SetupPlacement[]) => void;
  deploymentCount: number;
  hasAvailableDeploymentOptions: boolean;
  selectingDeployment: boolean;
  selectedPiece?: string;
  onFinishDeployment: () => void;
  onUndoDeployment: () => void;
  onChooseStartingChoice: (kind: "research" | "deploy") => void;
};

export function SetupPanel({ activeSetup, board, setupSeat, online, showSetupSummary = true, playerIndex, participants, participantReady, canToggleReady, readinessPending, setupActionPending, onToggleReady, onChooseOption, onPlaceUnusedBranches, onChooseStartingChoice, deploymentCount, hasAvailableDeploymentOptions, selectingDeployment, selectedPiece, onFinishDeployment, onUndoDeployment }: Props) {
  const [unusedPlacements, setUnusedPlacements] = useState<Record<string, string>>({});
  useEffect(() => {
    if (activeSetup.phase === "unused-branch-placement") setUnusedPlacements({});
  }, [activeSetup.phase]);
  const waiting = online && playerIndex !== setupSeat?.playerIndex;
  const disabled = Boolean(waiting || setupActionPending);
  const unusedBranches = useMemo(() => activeSetup.definition.eligibleBranches.filter((branch) => !activeSetup.seats.some((seat) => seat.branch === branch)), [activeSetup]);
  const setupSteps = ["Monster", "Branch", ...(activeSetup.definition.unusedBranchPlacements && (activeSetup.phase === "branch-selection" || unusedBranches.length > 0) ? ["Unused branches"] : []), "Lair", "Starting choice"];
  const activeStep = activeSetup.phase === "monster-selection" ? 0 : activeSetup.phase === "branch-selection" ? 1 : activeSetup.phase === "unused-branch-placement" ? 2 : activeSetup.phase === "lair-selection" ? setupSteps.length - 2 : setupSteps.length - 1;
  const unusedUnitIds = activeSetup.definition.unusedBranchPlacements ? unusedBranches.flatMap((branch) => activeSetup.definition.unusedBranchPlacements?.unitIdsByBranch[branch] ?? []) : [];
  const completeUnusedPlacements = unusedUnitIds.length > 0 && unusedBranches.every((branch) => {
    const ids = activeSetup.definition.unusedBranchPlacements?.unitIdsByBranch[branch] ?? [];
    const destinations = ids.map((id) => unusedPlacements[id]);
    return destinations.every(Boolean) && new Set(destinations).size === destinations.length;
  });
  const lairLabel = (key?: string, monsterId = setupSeat?.monsterId) => key && monsterId ? setupLairLabel(activeSetup, board, monsterId, key) : "Not selected";
  if (activeSetup.phase === "lair-selection") {
    const lairs = setupSeat?.monsterId
      ? activeSetup.definition.lairsByMonster[setupSeat.monsterId]?.filter((lair) => !activeSetup.seats.some((seat) => seat.lair === lair)) ?? [] : [];
    return <section className="setup-panel lair-selection-prompt" aria-label="Game setup">
      <ol className="setup-step-track" aria-label="Setup progress">{setupSteps.map((step, index) => <li key={step} className={index < activeStep ? "complete" : index === activeStep ? "current" : "upcoming"}>{step}</li>)}</ol>
      <strong>{waiting ? `Waiting for Player ${(setupSeat?.playerIndex ?? 0) + 1}` : `Player ${(setupSeat?.playerIndex ?? 0) + 1} · Choose your lair`}</strong>
      <span>Click a glowing spawn on the map.</span>
      <details key={setupSeat?.playerIndex}>
        <summary>Choose from list</summary>
        <div className="setup-options">{lairs.map((lair) => <button key={lair} disabled={disabled} onClick={() => onChooseOption(lair)}>{lairLabel(lair)}</button>)}</div>
      </details>
    </section>;
  }
  if (activeSetup.phase === "unused-branch-placement") {
    return <section className="setup-panel unused-branch-placement" aria-label="Place unused branch units">
      <ol className="setup-step-track" aria-label="Setup progress">{setupSteps.map((step, index) => <li key={step} className={index < activeStep ? "complete" : index === activeStep ? "current" : "upcoming"}>{step}</li>)}</ol>
      <span className="label">GAME SETUP</span>
      <h2>Place unused branches</h2>
      <p>The player who chose a monster last places each unused branch’s units, one on each of that branch’s bases.</p>
      <p className="setup-turn">{waiting ? `Waiting for Player ${(setupSeat?.playerIndex ?? 0) + 1}` : `Player ${(setupSeat?.playerIndex ?? 0) + 1} · Place the units`}</p>
      {unusedBranches.map((branch) => {
        const units = activeSetup.definition.unusedBranchPlacements?.unitIdsByBranch[branch] ?? [];
        const bases = activeSetup.definition.unusedBranchPlacements?.basesByBranch[branch] ?? [];
        return <fieldset className="setup-unused-branch" key={branch} disabled={disabled}>
          <legend>{branch} · {bases.length} bases</legend>
          {units.map((unitId) => {
            const unit = UNIT_DEFINITIONS.find((candidate) => candidate.id === activeSetup.definition.unusedBranchPlacements?.unitTypeById[unitId]);
            const assignedElsewhere = new Set(Object.entries(unusedPlacements).filter(([id]) => units.includes(id)).map(([, destination]) => destination));
            return <label key={unitId}>{unit?.name ?? unitId}<select aria-label={`${branch} ${unit?.name ?? unitId} base`} value={unusedPlacements[unitId] ?? ""} onChange={(event) => setUnusedPlacements((current) => ({ ...current, [unitId]: event.target.value }))}>
              <option value="">Choose a base</option>
              {bases.map((base) => <option key={base} value={base} disabled={assignedElsewhere.has(base) && unusedPlacements[unitId] !== base}>{board?.hexes[base as HexKey]?.label ?? base}</option>)}
            </select></label>;
          })}
        </fieldset>;
      })}
      <button disabled={disabled || !completeUnusedPlacements} onClick={() => onPlaceUnusedBranches(unusedUnitIds.map((unitId) => ({ unitId, destination: unusedPlacements[unitId]! })))}>Place units and continue</button>
    </section>;
  }
  return (
    <>
      {activeSetup.phase !== "complete" && (
        <section className={`setup-panel ${activeSetup.phase === "starting-choice" ? "setup-command-panel" : ""}`} aria-label="Game setup">
          <ol className="setup-step-track" aria-label="Setup progress">{setupSteps.map((step, index) => <li key={step} className={index < activeStep ? "complete" : index === activeStep ? "current" : "upcoming"}>{step}</li>)}</ol>
          <span className="label">GAME SETUP</span>
          <h2>{activeSetup.phase.replaceAll("-", " ")}</h2>
          <p>{activeSetup.phase === "starting-choice" ? "Deploy starting troops using your branch allowance, or draw one Military Research card instead." : "Choose your monster and military branch."}</p>
          {setupSeat && <p className="setup-turn">Choosing for Player {setupSeat.playerIndex + 1}{waiting ? " · waiting" : ""}</p>}
          <div className={`setup-options ${activeSetup.phase === "monster-selection" ? "monster-options" : activeSetup.phase === "branch-selection" ? "branch-options" : ""}`}>
            {activeSetup.phase === "monster-selection" && activeSetup.definition.monsterIds.map((id, index) => {
              // The local development fixture uses placeholder IDs; keep its cards visual too.
              const monster = monsterDefinition(id) ?? monsters.find((candidate) => candidate.id === id) ?? monsters[index];
              if (!monster) return null;
              const catalogueMonster = monsterDefinition(monster.name.toLowerCase());
              const selectedBy = activeSetup.seats.find((seat) => seat.monsterId === id);
              return (
                <button
                  className={`monster-choice ${selectedBy ? "monster-choice-selected" : ""}`}
                  key={id}
                  disabled={disabled || Boolean(selectedBy)}
                  onClick={() => onChooseOption(id)}
                  aria-label={`Choose ${monster.name}. Health ${monster.startingHealth}, move ${monster.move}, defense ${monster.defense}. ${catalogueMonster?.specialAbilityText ?? "Special ability details unavailable."}`}
                >
                  <img src={`/assets/monsters/portraits/${monsterAssetSlug(catalogueMonster?.id ?? monster.name)}.webp`} alt="" aria-hidden="true" />
                  <strong>{monster.name}</strong>
                  <span className="monster-choice-stats">♥ {monster.startingHealth} · Move {monster.move} · Def {monster.defense}</span>
                  <span className="monster-choice-ability">
                    <b>Special ability</b>
                    <span>{catalogueMonster?.specialAbilityText ?? "Special ability details unavailable."}</span>
                    <small>Health {monster.startingHealth} · {monster.attacks} attacks · {monster.damage} damage</small>
                  </span>
                  {selectedBy && <em>Player {selectedBy.playerIndex + 1}</em>}
                </button>
              );
            })}
            {activeSetup.phase === "branch-selection" && activeSetup.definition.eligibleBranches.map((branch) => {
              const owner = activeSetup.seats.find((seat) => seat.branch === branch);
              const roster = UNIT_DEFINITIONS.filter((unit) => unit.branch === branch);
              const description = {
                Army: "Land control: tough tanks and missile launchers with an extra opening attack.",
                Navy: "Sea and air reach: fast fighters and submarines that can launch as cruise missiles.",
                "Air Force": "Long-range strikes: six fighters and two powerful, single-use cruise missiles.",
                Marines: "Combined arms: flying fighters and rocket launchers that deal 2 damage per hit.",
              }[branch];
              return <button key={branch} data-branch={branch} className={`branch-choice ${owner ? "branch-claimed" : ""}`} disabled={disabled || Boolean(owner)} onClick={() => onChooseOption(branch)} aria-label={`Choose ${branch}${owner ? ` · selected by Player ${owner.playerIndex + 1}` : ""}`}>
                <strong className="branch-title">{branch}</strong>
                <span className="branch-description">{description}</span>
                <span className="branch-roster">{roster.map((unit) => <span className="branch-unit" key={unit.id}>
                  <img src={`/assets/military/${unit.id}.webp`} alt="" />
                  <span className="branch-unit-details">
                  <strong>{unit.quantity} × {unit.name}</strong>
                  <span>Move {unit.move} · Defense {Array.isArray(unit.defense) ? unit.defense.join(" / ") : unit.defense} · Damage {Array.isArray(unit.damage) ? unit.damage.join(" / ") : unit.damage}</span>
                  {unit.id === "navy-nuclear-submarine" && <small>Submarine / missile stats · missile movement 8</small>}
                  {unit.specialAbilityText && <small>{unit.specialAbilityText}</small>}
                  </span>
                </span>)}</span>
                <span className="branch-select-label">{owner ? `✓ Player ${owner.playerIndex + 1}` : `Choose ${branch} →`}</span>
              </button>;
            })}
            {activeSetup.phase === "starting-choice" && <>
              {!(selectingDeployment && !hasAvailableDeploymentOptions) && <>
                {deploymentCount === 0 && <button disabled={disabled} onClick={() => onChooseStartingChoice("research")}>Draw Research</button>}
                <button disabled={disabled} onClick={() => onChooseStartingChoice("deploy")}>{selectingDeployment ? "Choose another starting unit" : "Deploy starting troops"}</button>
              </>}
              {selectingDeployment && !hasAvailableDeploymentOptions && <><p>{deploymentCount} starting troop{deploymentCount === 1 ? "" : "s"} placed.{selectedPiece ? ` Place ${selectedPiece.replaceAll("-", " ")} on a glowing location.` : " Choose a piece from your military sheet."}</p><button disabled={disabled || !deploymentCount} onClick={onFinishDeployment}>Finish starting deployment</button><button disabled={disabled || !deploymentCount} onClick={onUndoDeployment}>Undo last placement</button></>}
            </>}
          </div>
          <p className="setup-progress">{activeSetup.seats.filter((seat) => seat.ready).length}/{activeSetup.seats.length} starting choices confirmed</p>
        </section>
      )}
      {online && showSetupSummary && activeSetup.phase === "complete" && (
        <section className="setup-summary" aria-label="Setup summary">
          <span className="label">SETUP LOCKED</span>
          <h2>Match configuration</h2>
          <p>Assignments are set. Each player must confirm they are ready to begin.</p>
          <div className="setup-summary-grid">
            {activeSetup.seats.map((seat) => (
              <div key={seat.playerIndex}>
                <strong>Player {seat.playerIndex + 1}</strong>
                <span>{monsters.find(monster => monster.id === seat.monsterId)?.name ?? seat.monsterId} · {seat.branch}</span>
                <span>Lair: {lairLabel(seat.lair, seat.monsterId)}</span>
                <span>{participants.find((candidate) => candidate.playerIndex === seat.playerIndex)?.ready ? "Ready" : "Not ready"}</span>
              </div>
            ))}
          </div>
          {canToggleReady && <button className="setup-ready-toggle" type="button" aria-pressed={participantReady} disabled={readinessPending} onClick={onToggleReady}>
            {readinessPending ? "Updating readiness…" : participantReady ? "Not ready" : "Ready to begin"}
          </button>}
        </section>
      )}
    </>
  );
}

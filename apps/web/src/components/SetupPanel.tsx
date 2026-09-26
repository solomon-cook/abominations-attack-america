import { monsterDefinition, monsters, UNIT_DEFINITIONS, type BoardDefinition, type SetupState } from "@abominations/game-engine";
import { setupLairLabel } from "./setup-location-label";
import type { RoomView } from "@abominations/shared";
import { monsterAssetSlug } from "../monster-assets";

type Props = {
  activeSetup: SetupState;
  board?: BoardDefinition;
  setupSeat?: SetupState["seats"][number];
  online: boolean;
  playerIndex?: number;
  participants: RoomView["participants"];
  onChooseOption: (value: string) => void;
  deploymentCount: number;
  hasAvailableDeploymentOptions: boolean;
  selectingDeployment: boolean;
  selectedPiece?: string;
  onFinishDeployment: () => void;
  onUndoDeployment: () => void;
  onChooseStartingChoice: (kind: "research" | "deploy") => void;
};

export function SetupPanel({ activeSetup, board, setupSeat, online, playerIndex, participants, onChooseOption, onChooseStartingChoice, deploymentCount, hasAvailableDeploymentOptions, selectingDeployment, selectedPiece, onFinishDeployment, onUndoDeployment }: Props) {
  const waiting = online && playerIndex !== setupSeat?.playerIndex;
  const disabled = Boolean(waiting);
  const setupSteps = ["Monster", "Branch", "Lair", "Starting choice"];
  const activeStep = ({ "monster-selection": 0, "branch-selection": 1, "lair-selection": 2, "starting-choice": 3 } as const)[activeSetup.phase as "monster-selection" | "branch-selection" | "lair-selection" | "starting-choice"] ?? 3;
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
      {online && activeSetup.phase === "complete" && (
        <section className="setup-summary" aria-label="Setup summary">
          <span className="label">SETUP LOCKED</span>
          <h2>Match configuration</h2>
          <p>Assignments are set. Each player must press Ready to begin.</p>
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
        </section>
      )}
    </>
  );
}

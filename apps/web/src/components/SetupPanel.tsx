import { monsterDefinition, monsters, type BoardDefinition, type SetupState } from "@abominations/game-engine";
import { setupLairLabel } from "./setup-location-label";
import type { RoomView } from "@abominations/shared";

type Props = {
  activeSetup: SetupState;
  board?: BoardDefinition;
  setupSeat?: SetupState["seats"][number];
  online: boolean;
  playerIndex?: number;
  participants: RoomView["participants"];
  onChooseOption: (value: string) => void;
  deploymentCount: number;
  selectingDeployment: boolean;
  selectedPiece?: string;
  onFinishDeployment: () => void;
  onUndoDeployment: () => void;
  onChooseStartingChoice: (kind: "research" | "deploy") => void;
};

export function SetupPanel({ activeSetup, board, setupSeat, online, playerIndex, participants, onChooseOption, onChooseStartingChoice, deploymentCount, selectingDeployment, selectedPiece, onFinishDeployment, onUndoDeployment }: Props) {
  const waiting = online && playerIndex !== setupSeat?.playerIndex;
  const disabled = Boolean(waiting);
  const lairLabel = (key?: string, monsterId = setupSeat?.monsterId) => key && monsterId ? setupLairLabel(activeSetup, board, monsterId, key) : "Not selected";
  return (
    <>
      {activeSetup.phase !== "complete" && (
        <section className="setup-panel" aria-label="Game setup">
          <span className="label">GAME SETUP</span>
          <h2>{activeSetup.phase.replaceAll("-", " ")}</h2>
          <p>{activeSetup.phase === "lair-selection" ? "Choose one of your monster’s glowing lairs on the board, or select it below." : activeSetup.phase === "starting-choice" ? "Deploy starting troops using your branch allowance, or draw one Military Research card instead." : "Choose your monster and military branch."}</p>
          {setupSeat && <p className="setup-turn">Choosing for Player {setupSeat.playerIndex + 1}{waiting ? " · waiting" : ""}</p>}
          <div className={`setup-options ${activeSetup.phase === "monster-selection" ? "monster-options" : ""}`}>
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
                  <img src={`/assets/monsters/portraits/${catalogueMonster?.id ?? monster.name.toLowerCase()}.webp`} alt="" aria-hidden="true" />
                  <strong>{monster.name}</strong>
                  <span className="monster-choice-stats">♥ {monster.startingHealth} · Move {monster.move} · Def {monster.defense}</span>
                  <span className="monster-choice-hover">
                    <b>Special ability</b>
                    <span>{catalogueMonster?.specialAbilityText ?? "Special ability details unavailable."}</span>
                    <small>Health {monster.startingHealth} · {monster.attacks} attacks · {monster.damage} damage</small>
                  </span>
                  {selectedBy && <em>Player {selectedBy.playerIndex + 1}</em>}
                </button>
              );
            })}
            {activeSetup.phase === "branch-selection" && activeSetup.definition.eligibleBranches.filter((branch) => !activeSetup.seats.some((seat) => seat.branch === branch)).map((branch) => <button key={branch} disabled={disabled} onClick={() => onChooseOption(branch)}>{branch}</button>)}
            {activeSetup.phase === "lair-selection" && setupSeat?.monsterId && activeSetup.definition.lairsByMonster[setupSeat.monsterId]?.filter((lair) => !activeSetup.seats.some((seat) => seat.lair === lair)).map((lair) => <button key={lair} disabled={disabled} onClick={() => onChooseOption(lair)}>{lairLabel(lair)}</button>)}
            {activeSetup.phase === "starting-choice" && <>
              <button disabled={disabled || deploymentCount > 0} onClick={() => onChooseStartingChoice("research")}>Draw Research</button>
              <button disabled={disabled} onClick={() => onChooseStartingChoice("deploy")}>{selectingDeployment ? "Choose another starting unit" : "Deploy starting troops"}</button>
              {selectingDeployment && <><p>{deploymentCount} starting troop{deploymentCount === 1 ? "" : "s"} placed.{selectedPiece ? ` Place ${selectedPiece.replaceAll("-", " ")} on a glowing location.` : " Choose a piece from your military sheet."}</p><button disabled={disabled || !deploymentCount} onClick={onFinishDeployment}>Finish starting deployment</button><button disabled={disabled || !deploymentCount} onClick={onUndoDeployment}>Undo last placement</button></>}
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

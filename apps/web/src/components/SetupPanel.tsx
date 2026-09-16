import { monsters, type BoardDefinition, type HexKey, type SetupState } from "@abominations/game-engine";
import type { RoomView } from "@abominations/shared";

type Props = {
  activeSetup: SetupState;
  board?: BoardDefinition;
  setupSeat?: SetupState["seats"][number];
  online: boolean;
  playerIndex?: number;
  participants: RoomView["participants"];
  onChooseOption: (value: string) => void;
  onChooseStartingChoice: (kind: "research" | "deploy") => void;
};

export function SetupPanel({ activeSetup, board, setupSeat, online, playerIndex, participants, onChooseOption, onChooseStartingChoice }: Props) {
  const waiting = online && playerIndex !== setupSeat?.playerIndex;
  const disabled = Boolean(waiting);
  const lairLabel = (key?: string) => {
    if (!key) return "Not selected";
    const hex = board?.hexes[key as HexKey];
    return hex?.audit ? `Cell ${hex.audit.row}/${hex.audit.column}` : hex?.label ?? key;
  };
  return (
    <>
      {activeSetup.phase !== "complete" && (
        <section className="setup-panel" aria-label="Game setup">
          <span className="label">CHOOSE YOUR MONSTER</span>
          <h2>{activeSetup.phase.replaceAll("-", " ")}</h2>
          <p>Choose a monster, military branch and starting lair.</p>
          {setupSeat && <p className="setup-turn">Choosing for Player {setupSeat.playerIndex + 1}{waiting ? " · waiting" : ""}</p>}
          <div className="setup-options">
            {activeSetup.phase === "monster-selection" && activeSetup.definition.monsterIds.filter((id) => !activeSetup.seats.some((seat) => seat.monsterId === id)).map((id) => <button key={id} disabled={disabled} onClick={() => onChooseOption(id)}>{monsters.find(monster => monster.id === id)?.name ?? id}</button>)}
            {activeSetup.phase === "branch-selection" && activeSetup.definition.eligibleBranches.filter((branch) => !activeSetup.seats.some((seat) => seat.branch === branch)).map((branch) => <button key={branch} disabled={disabled} onClick={() => onChooseOption(branch)}>{branch}</button>)}
            {activeSetup.phase === "lair-selection" && setupSeat?.monsterId && activeSetup.definition.lairsByMonster[setupSeat.monsterId]?.filter((lair) => !activeSetup.seats.some((seat) => seat.lair === lair)).map((lair) => <button key={lair} disabled={disabled} onClick={() => onChooseOption(lair)}>{lairLabel(lair)}</button>)}
            {activeSetup.phase === "starting-choice" && <>
              <button disabled={disabled} onClick={() => onChooseStartingChoice("research")}>Draw Research</button>
              <button disabled={disabled} onClick={() => onChooseStartingChoice("deploy")}>Deploy units</button>
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
                <span>Lair: {lairLabel(seat.lair)}</span>
                <span>{participants.find((candidate) => candidate.playerIndex === seat.playerIndex)?.ready ? "Ready" : "Not ready"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

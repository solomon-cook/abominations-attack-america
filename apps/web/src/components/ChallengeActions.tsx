import type { GameCommand, GameState } from "@abominations/game-engine";

type Props = {
  activeGame: GameState;
  canAct: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
};

export function ChallengeActions({ activeGame, canAct, runCommand }: Props) {
  const decision = activeGame.pendingDecision;
  if (decision?.type === "challenge-opponent") {
    return (
      <div className="battle-choice" aria-label="Choose Monster Challenge opponent">
        <p>Choose an eligible monster to weigh in and fight. Monsters in Hollywood are excluded.</p>
        {decision.opponentIds.map((monsterId) => {
          const monster = activeGame.monsters.find((candidate) => candidate.id === monsterId);
          return <button key={monsterId} disabled={!canAct} onClick={() => void runCommand({ type: "challenge-opponent", opponentMonsterId: monsterId })}>{monster?.name ?? monsterId}</button>;
        })}
        {decision.opponentIds.length === 0 && <strong>No eligible monster remains.</strong>}
      </div>
    );
  }
  if (decision?.type === "challenge-resolution") {
    const challenger = activeGame.monsters.find((monster) => monster.id === decision.challengerMonsterId);
    const opponent = activeGame.monsters.find((monster) => monster.id === decision.opponentMonsterId);
    const weighIn = activeGame.challenge?.weighInHealth ?? {};
    return (
      <div className="battle-choice" aria-label="Resolve Monster Challenge duel">
        <p>{challenger?.name ?? decision.challengerMonsterId} vs {opponent?.name ?? decision.opponentMonsterId}</p>
        <small>Weigh-in Health: {weighIn[decision.challengerMonsterId] ?? "—"} vs {weighIn[decision.opponentMonsterId] ?? "—"}. Challenger attacks first.</small>
        <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-challenge" })}>Resolve duel</button>
      </div>
    );
  }
  if (decision?.type === "challenge-giant") {
    return (
      <div className="battle-choice" aria-label="Choose giant Monster Challenge opponent">
        <p>All surviving monsters have fought. Choose the next surviving giant military unit; giants are challenged last and never fight each other.</p>
        {decision.giantUnitIds.map((unitId) => {
          const unit = activeGame.units.find((candidate) => candidate.id === unitId);
          return <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "challenge-giant", giantUnitId: unitId })}>{unit?.unitTypeId ?? unitId}</button>;
        })}
      </div>
    );
  }
  if (decision?.type === "challenge-giant-resolution") {
    const challenger = activeGame.monsters.find((monster) => monster.id === decision.challengerMonsterId);
    const giant = activeGame.units.find((unit) => unit.id === decision.giantUnitId);
    return (
      <div className="battle-choice" aria-label="Resolve giant Monster Challenge duel">
        <p>{challenger?.name ?? decision.challengerMonsterId} vs {giant?.unitTypeId ?? decision.giantUnitId}</p>
        <small>The giant is challenged last. Resolve the authoritative unlimited duel; America is saved if the giant defeats the challenger.</small>
        <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-challenge" })}>Resolve giant duel</button>
      </div>
    );
  }
  return null;
}

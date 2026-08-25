import type { Dispatch, SetStateAction } from "react";
import { BRANCH_DEPLOYMENT_DEFINITIONS, legalOwnedRedeploymentDestinations, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";

type AttackTargetDecision = Extract<NonNullable<GameState["pendingDecision"]>, { type: "attack-target" }>;
type BattleDecision = Extract<NonNullable<GameState["pendingDecision"]>, { type: "battle-resolution" }>;

type Props = {
  activeGame: GameState;
  canAct: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
  getLocationName: (key: HexKey) => string;
  pendingAttackTarget?: AttackTargetDecision;
  pendingAttackPrompt: string;
  pendingBattle?: GameState["pendingBattles"][number];
  pendingBattleDecision?: BattleDecision;
  canSpendInfamyOnPendingBattle: boolean;
  retreatChoices: Record<string, HexKey | "disappeared">;
  setRetreatChoices: Dispatch<SetStateAction<Record<string, HexKey | "disappeared">>>;
  ownDeploymentAvailable: boolean;
  availableGuardUnitId?: string;
  guardDeploymentDestination?: HexKey;
  guardDeploymentAvailable: boolean;
};

export function PhaseActions({
  activeGame,
  canAct,
  runCommand,
  getLocationName,
  pendingAttackTarget,
  pendingAttackPrompt,
  pendingBattle,
  pendingBattleDecision,
  canSpendInfamyOnPendingBattle,
  retreatChoices,
  setRetreatChoices,
  ownDeploymentAvailable,
  availableGuardUnitId,
  guardDeploymentDestination,
  guardDeploymentAvailable,
}: Props) {
  if (activeGame.phase === "fight" && pendingAttackTarget) {
    return (
      <div className="battle-choice" aria-label="Choose the monster attack target">
        <p>{pendingAttackPrompt}</p>
        {pendingAttackTarget.targetIds.map((unitId) => {
          const unit = activeGame.units.find((candidate) => candidate.id === unitId);
          return <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingAttackTarget.battleId, targetUnitId: unitId })}>Attack {unit?.branch ?? unitId} ({unit?.unitTypeId ?? "unit"})</button>;
        })}
      </div>
    );
  }

  if (activeGame.phase === "fight" && activeGame.pendingDecision?.type === "retreat" && activeGame.pendingRetreat) {
    return (
      <div className="retreat-choice" aria-label="Choose retreat destinations">
        {activeGame.pendingRetreat.unitIds.map((unitId) => {
          const unit = activeGame.units.find((candidate) => candidate.id === unitId);
          const options = activeGame.pendingRetreat?.options[unitId] ?? [];
          const selected = retreatChoices[unitId] ?? (options.length === 0 ? "disappeared" : undefined);
          return <div className="retreat-unit" key={unitId}>
            <span>{unit?.branch ?? unitId}</span>
            {options.length === 0 ? <strong>Forced disappearance</strong> : options.map((destination) => <button className={selected === destination ? "selected-choice" : ""} key={destination} disabled={!canAct} onClick={() => setRetreatChoices((current) => ({ ...current, [unitId]: destination }))}>{getLocationName(destination)}</button>)}
          </div>;
        })}
        <button disabled={!canAct || activeGame.pendingRetreat.unitIds.some((unitId) => !retreatChoices[unitId] && (activeGame.pendingRetreat?.options[unitId]?.length ?? 0) > 0)} onClick={() => {
          const destinations = Object.fromEntries(activeGame.pendingRetreat!.unitIds.map((unitId) => [unitId, retreatChoices[unitId] ?? "disappeared"]));
          void runCommand({ type: "retreat", destinations });
        }}>Confirm retreat</button>
      </div>
    );
  }

  if (activeGame.phase === "fight" && activeGame.pendingBattles.length > 1) {
    return <div className="battle-choice" aria-label="Choose battle resolution order">
      {activeGame.pendingBattles.map((battle) => {
        const monster = activeGame.monsters.find((candidate) => candidate.id === battle.monsterId);
        return <button key={battle.id} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: battle.id })}>Resolve {monster?.name ?? battle.monsterId} at {getLocationName(battle.location)} ({battle.militaryUnitIds.length} unit{battle.militaryUnitIds.length === 1 ? "" : "s"})</button>;
      })}
    </div>;
  }

  if (activeGame.phase === "fight" && pendingBattle && pendingBattleDecision && canSpendInfamyOnPendingBattle) {
    return <div className="battle-choice" aria-label="Choose whether to spend Infamy on this battle">
      <p>Choose whether to spend one Infamy for an additional monster attack this round.</p>
      <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingBattle.id })}>Resolve without spending Infamy</button>
      <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingBattle.id, spendInfamy: 1 })}>Spend 1 Infamy · add one attack</button>
    </div>;
  }

  if (activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "trophy-choice") {
    return <div className="battle-choice" aria-label="Choose a military trophy">
      <p>Player {activeGame.pendingDecision.playerIndex + 1}, choose one {activeGame.pendingDecision.branch} unit as the monster&apos;s trophy.</p>
      {activeGame.pendingDecision.unitIds.map((unitId) => {
        const unit = activeGame.units.find((candidate) => candidate.id === unitId);
        return <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-encounter", trophyUnitId: unitId })}>Take {unit?.unitTypeId ?? unitId} ({unit?.location === "record-tile" ? "record tile" : "board"})</button>;
      })}
    </div>;
  }

  if (activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "encounter-choice") {
    return <div className="battle-choice" aria-label="Choose Zorb city benefit">
      {activeGame.pendingDecision.choices.map((choice) => <button key={choice} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-encounter", choice })}>{choice === "health" ? "Take the city Health benefit" : "Take 2 Infamy instead"}</button>)}
    </div>;
  }

  if (activeGame.phase === "deploy") {
    const activeBranch = activeGame.setupAssignments?.[activeGame.currentPlayer]?.branch
      ?? (["Army", "Navy", "Air Force", "Marines"] as const)[activeGame.currentPlayer % 4];
    const allowance = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === activeBranch)?.ownOrGuardUnits ?? 0;
    const canRedeploy = activeGame.deploymentsThisTurn < allowance;
    const redeploymentChoices = canRedeploy
      ? activeGame.units.flatMap((unit) => legalOwnedRedeploymentDestinations(activeGame, unit.id).map((destination) => ({ unit, destination })))
      : [];
    return <div className="path-controls">
      <button disabled={!canAct || !ownDeploymentAvailable} onClick={() => void runCommand({ type: "deploy" })}>{ownDeploymentAvailable ? "Deploy one unit" : "No owned deployment available"}</button>
      {availableGuardUnitId && guardDeploymentDestination && <button disabled={!canAct || !guardDeploymentAvailable} onClick={() => void runCommand({ type: "deploy", unitId: availableGuardUnitId, destination: guardDeploymentDestination })}>Deploy Guard to {getLocationName(guardDeploymentDestination)}</button>}
      {redeploymentChoices.length > 0 && <div className="battle-choice" aria-label="Choose unit redeployment">
        <span>Redeploy an owned branch unit to an unstomped base:</span>
        {redeploymentChoices.map(({ unit, destination }) => <button key={`${unit.id}-${destination}`} disabled={!canAct} onClick={() => void runCommand({ type: "redeploy", unitId: unit.id, destination })}>{unit.unitTypeId ?? unit.id} → {getLocationName(destination)}</button>)}
      </div>}
      <button disabled={!canAct || activeGame.decks.research.exhausted} onClick={() => void runCommand({ type: "draw-research" })}>{activeGame.decks.research.exhausted ? "Military Research exhausted" : "Draw Military Research instead"}</button>
      <button className="cancel" disabled={!canAct} onClick={() => void runCommand({ type: "pass-deploy" })}>Pass deployment</button>
    </div>;
  }

  return null;
}

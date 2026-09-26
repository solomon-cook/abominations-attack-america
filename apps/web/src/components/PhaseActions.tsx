import type { Dispatch, SetStateAction } from "react";
import { legalLaserFenceTargets, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { DieCube } from "./DieCube";
import { deploymentChoices } from "./MilitarySheet";
import { LaserFenceControls } from "./LaserFenceControls";
import { StabilizerRayControls } from "./StabilizerRayControls";
import { ToxicorMutationControls } from "./ToxicorMutationControls";

type AttackTargetDecision = Extract<NonNullable<GameState["pendingDecision"]>, { type: "attack-target" }>;
type BattleDecision = Extract<NonNullable<GameState["pendingDecision"]>, { type: "battle-resolution" }>;

type Props = {
  activeGame: GameState;
  hideAttackTargets?: boolean;
  canUseMutation?: boolean;
  canUseLaserFence?: boolean;
  onOpenMilitarySheet: () => void;
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
};

export function PhaseActions({
  activeGame,
  hideAttackTargets = false,
  onOpenMilitarySheet,
  canAct,
  canUseMutation = canAct,
  canUseLaserFence = canAct,
  runCommand,
  getLocationName,
  pendingAttackTarget,
  pendingAttackPrompt,
  pendingBattle,
  pendingBattleDecision,
  canSpendInfamyOnPendingBattle,
  retreatChoices,
  setRetreatChoices,
}: Props) {
  const mutationButtons = (battleId: string) => {
    const ownerIndex = activeGame.pendingBattles.find((battle) => battle.id === battleId)
      ? activeGame.monsters.findIndex((monster) => monster.id === activeGame.pendingBattles.find((battle) => battle.id === battleId)?.monsterId)
      : -1;
    const optionalMutationCards = activeGame.players[ownerIndex]?.mutationCardIds.filter((cardId) => cardId === "Berserk" || cardId === "Son of a Monster") ?? [];
    return optionalMutationCards.length > 0 ? (
    <div className="battle-choice" aria-label="Optional Mutation battle abilities">
      <span>Optional Mutation:</span>
      {optionalMutationCards.map((cardId) => <button key={cardId} disabled={!canUseMutation} onClick={() => void runCommand({ type: "use-mutation", cardId, battleId })}>{cardId === "Berserk" ? "Berserk · +5 attacks" : "Son of a Monster · +2 attacks and d6 Health"}</button>)}
    </div>
    ) : null;
  };
  const defenseSatellitesButton = activeGame.players[activeGame.currentPlayer]?.researchCardIds.includes("Defense Satellites") ? (
    <button disabled={!canAct || activeGame.pendingBattles.length > 0 || Boolean(activeGame.pendingRetreat)} onClick={() => void runCommand({ type: "use-research", cardId: "Defense Satellites" })}>Use Defense Satellites · roll for each monster</button>
  ) : null;
  const antimatterButton = pendingBattle && pendingBattleDecision && activeGame.players[activeGame.currentPlayer]?.researchCardIds.includes("Antimatter") ? (
    <button disabled={!canAct} onClick={() => void runCommand({ type: "use-research", cardId: "Antimatter", battleId: pendingBattle.id })}>Use Antimatter · double first-round damage</button>
  ) : null;
  const laserFenceOwnerIndex = activeGame.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
  const laserFenceControls = <LaserFenceControls game={activeGame} cardOwnerIndex={laserFenceOwnerIndex} canUse={canUseLaserFence} runCommand={runCommand} getLocationName={getLocationName} />;
  if (activeGame.pendingDecision?.type === "stabilizer-ray-choice" && activeGame.pendingStabilizerRayChoice) {
    return <StabilizerRayControls game={activeGame} canAct={canAct} runCommand={runCommand} />;
  }
  if (activeGame.pendingDecision?.type === "mutation-choice") {
    return <ToxicorMutationControls game={activeGame} canAct={canAct} runCommand={runCommand} />;
  }

  if (activeGame.phase === "fight" && pendingAttackTarget) {
    return (
      <div className="battle-choice" aria-label="Choose the monster attack target">
        <p>{pendingAttackPrompt}</p>
        {mutationButtons(pendingAttackTarget.battleId)}
        {defenseSatellitesButton}
        {!hideAttackTargets && pendingAttackTarget.targetIds.map((unitId) => {
          const unit = activeGame.units.find((candidate) => candidate.id === unitId);
          return <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingAttackTarget.battleId, targetUnitId: unitId })}>Attack {unit?.branch ?? unitId} ({unit?.unitTypeId ?? "unit"})</button>;
        })}
      </div>
    );
  }

  if (activeGame.phase === "fight" && activeGame.pendingDecision?.type === "retreat" && activeGame.pendingRetreat) {
    if (activeGame.pendingRetreat.monsterId) {
      const monster = activeGame.monsters.find((candidate) => candidate.id === activeGame.pendingRetreat?.monsterId);
      return <div className="retreat-choice" aria-label="Choose monster retreat destination">
        <strong>{monster?.name ?? "Monster"} must retreat.</strong>
        <span>Select a glowing adjacent hex on the board.</span>
      </div>;
    }
    return (
      <div className="retreat-choice" aria-label="Choose retreat destinations">
        {defenseSatellitesButton}
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
      {defenseSatellitesButton}
      {laserFenceControls}
      {pendingBattle && <>
        {antimatterButton}
        <StabilizerRayControls game={activeGame} battleId={pendingBattle.id} canAct={canAct} runCommand={runCommand} />
      </>}
      {activeGame.pendingBattles.map((battle) => {
        const monster = activeGame.monsters.find((candidate) => candidate.id === battle.monsterId);
        const submarines = battle.militaryUnitIds.filter((unitId) => activeGame.units.some((unit) => unit.id === unitId && unit.unitTypeId === "navy-nuclear-submarine"));
        return <div key={battle.id}>
          {!hideAttackTargets && <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: battle.id })}>Resolve {monster?.name ?? battle.monsterId} at {getLocationName(battle.location)} ({battle.militaryUnitIds.length} unit{battle.militaryUnitIds.length === 1 ? "" : "s"})</button>}
          {submarines.map((unitId) => <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "launch-submarine", battleId: battle.id, unitId })}>Launch Nuclear Submarine as cruise missile</button>)}
          {mutationButtons(battle.id)}
        </div>;
      })}
    </div>;
  }

  if (activeGame.phase === "fight" && pendingBattle && pendingBattleDecision && canSpendInfamyOnPendingBattle) {
    const submarines = pendingBattle.militaryUnitIds.filter((unitId) => activeGame.units.some((unit) => unit.id === unitId && unit.unitTypeId === "navy-nuclear-submarine"));
    return <div className="battle-choice" aria-label="Choose whether to spend Infamy on this battle">
      <p>Ready to fight. Add an extra attack for 1 Infamy.</p>
      {mutationButtons(pendingBattle.id)}
      {defenseSatellitesButton}
      {antimatterButton}
      {laserFenceControls}
      {pendingBattle && <StabilizerRayControls game={activeGame} battleId={pendingBattle.id} canAct={canAct} runCommand={runCommand} />}
      {submarines.map((unitId) => <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "launch-submarine", battleId: pendingBattle.id, unitId })}>Launch Nuclear Submarine as cruise missile</button>)}
      {!hideAttackTargets && <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingBattle.id })}><DieCube value={6} label="Roll battle dice" /> Roll battle dice</button>}
      {!hideAttackTargets && <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", battleId: pendingBattle.id, spendInfamy: 1 })}>Spend 1 Infamy · add one attack</button>}
    </div>;
  }

  if (activeGame.phase === "fight" && pendingBattle && pendingBattleDecision) {
    const submarines = pendingBattle.militaryUnitIds.filter((unitId) => activeGame.units.some((unit) => unit.id === unitId && unit.unitTypeId === "navy-nuclear-submarine"));
    return <div className="path-controls" aria-label="Battle research options">
      {mutationButtons(pendingBattle.id)}
      {defenseSatellitesButton}
      {antimatterButton}
      {laserFenceControls}
      <StabilizerRayControls game={activeGame} battleId={pendingBattle.id} canAct={canAct} runCommand={runCommand} />
      {submarines.map((unitId) => <button key={unitId} disabled={!canAct} onClick={() => void runCommand({ type: "launch-submarine", battleId: pendingBattle.id, unitId })}>Launch Nuclear Submarine as cruise missile</button>)}
    </div>;
  }

  if (activeGame.phase === "fight" && pendingBattleDecision && legalLaserFenceTargets(activeGame).length > 0) {
    return <div className="path-controls" aria-label="Available Laser Fence reaction">{laserFenceControls}</div>;
  }

  if (activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "trophy-choice") {
    return <div className="battle-choice" aria-label="Choose a military trophy">
      {defenseSatellitesButton}
      <p>Choose the highlighted {activeGame.pendingDecision.branch} unit from the military record or board.</p>
    </div>;
  }

  if (activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "encounter-choice") {
    const encounterDecision = activeGame.pendingDecision;
    const ironStomach = encounterDecision.source === "iron-stomach";
    return <div className="battle-choice" aria-label={ironStomach ? "Choose Iron Stomach base reward" : "Choose Zorb city benefit"}>
      {defenseSatellitesButton}
      {encounterDecision.healthRoll !== undefined && <p>Zorb rolled {encounterDecision.healthRoll} Health from the city.</p>}
      {ironStomach && <p>Iron Stomach: choose 3 Health or the base’s 1 Infamy.</p>}
      {encounterDecision.choices.map((choice) => <button key={choice} disabled={!canAct} onClick={() => void runCommand({ type: "resolve-encounter", choice })}>{choice === "health" ? `Take ${ironStomach ? 3 : encounterDecision.healthRoll ?? "the city"} Health` : `Take ${ironStomach ? 1 : 2} Infamy instead`}</button>)}
    </div>;
  }

  if (activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "encounter-resolution") {
    return <div className="path-controls" aria-label="Resolve encounter">
      {defenseSatellitesButton}
      {laserFenceControls}
      <button disabled={!canAct} onClick={() => void runCommand({ type: "resolve-encounter" })}>Resolve encounter</button>
    </div>;
  }

  if (activeGame.phase === "deploy") {
    const deploymentStarted = activeGame.deploymentsThisTurn > 0;
    const canDeployMore = deploymentChoices(activeGame).length > 0;
    return <div className="path-controls">
      {defenseSatellitesButton}
      <button disabled={!canAct || !canDeployMore} onClick={onOpenMilitarySheet}>{canDeployMore ? "Deploy military" : "No legal deployments remaining"}</button>
      {!deploymentStarted && <button disabled={!canAct || !canDeployMore || activeGame.decks.research.exhausted} onClick={() => void runCommand({ type: "draw-research" })}>{activeGame.decks.research.exhausted ? "Military Research exhausted" : !canDeployMore ? "No deployment options remaining" : "Draw Military Research instead"}</button>}
      {canDeployMore && <p className="path-status">{deploymentStarted ? "Choose another unit to deploy." : "Deploy or draw Military Research to continue."}</p>}
    </div>;
  }

  if (defenseSatellitesButton) return <div className="path-controls" aria-label="Available Military Research">{defenseSatellitesButton}</div>;
  return null;
}

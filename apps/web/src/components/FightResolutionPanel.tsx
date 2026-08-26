import type { GameState } from "@abominations/game-engine";
import { DieCube } from "./DieCube";

type Props = {
  game: GameState;
  canAct: boolean;
  pendingBattle?: GameState["pendingBattles"][number];
  pendingAttackTarget?: Extract<NonNullable<GameState["pendingDecision"]>, { type: "attack-target" }>;
  rolls: readonly number[];
  outcomes: readonly string[];
};

/** Focused normal-combat presentation; controls and outcomes remain engine-driven. */
export function FightResolutionPanel({ game, canAct, pendingBattle, pendingAttackTarget, rolls, outcomes }: Props) {
  const battle = pendingBattle ?? (game.pendingBattles.length === 1 ? game.pendingBattles[0] : undefined);
  const monster = battle ? game.monsters.find((candidate) => candidate.id === battle.monsterId) : undefined;
  const units = battle ? game.units.filter((unit) => battle.militaryUnitIds.includes(unit.id)) : [];
  const activeDecision = pendingAttackTarget
    ? `Choose attack ${pendingAttackTarget.attackNumber ?? 1}${pendingAttackTarget.attackTotal ? ` of ${pendingAttackTarget.attackTotal}` : ""} target`
    : battle
      ? "Resolve the next authoritative attack"
      : "Review the recorded combat result";
  if (!battle && rolls.length === 0 && outcomes.length === 0) return null;
  return (
    <section className="fight-resolution-panel" aria-live="polite" aria-label="Normal fight resolution surface">
      <div className="fight-resolution-heading">
        <div><span className="label">NORMAL FIGHT</span><h3>{activeDecision}</h3></div>
        <span className={`fight-resolution-status ${canAct ? "ready" : "waiting"}`}>{canAct ? "Your decision" : "Waiting"}</span>
      </div>
      <div className="fight-resolution-sides">
        <div className="fight-resolution-side fight-resolution-units">
          <span className="label">MILITARY UNITS</span>
          {units.length > 0 ? units.map((unit) => (
            <span className="fight-resolution-unit" key={unit.id}>
              <strong>{unit.branch} · {unit.unitTypeId ?? "unit"}</strong>
              <small><span className="metric-icon" aria-hidden="true">⚔</span> {unit.attacks} attack{unit.attacks === 1 ? "" : "s"} · <span className="metric-icon" aria-hidden="true">✦</span> {unit.damage} damage · <span className="metric-icon" aria-hidden="true">◆</span> {unit.defense} Defense</small>
            </span>
          )) : <small>Participating units are recorded in the authoritative battle state.</small>}
        </div>
        <div className="fight-resolution-dice" aria-label="Authoritative normal fight dice">
          <span className="label">DICE</span>
          {rolls.length > 0
            ? <div className="combat-roll-list">{rolls.map((roll, index) => <DieCube key={`${roll}-${index}`} value={roll} label={`Fight roll ${index + 1}: ${roll}`} />)}</div>
            : <strong>Rolls appear after resolution</strong>}
        </div>
        <div className="fight-resolution-side fight-resolution-monster">
          <span className="label">OPPOSING MONSTER</span>
          <strong>{monster?.name ?? "Monster in pending battle"}</strong>
          {monster && <small><span className="metric-icon" aria-hidden="true">♥</span> {monster.health}/{monster.maxHealth} Health · <span className="metric-icon" aria-hidden="true">◎</span> {monster.infamy} Infamy · <span className="metric-icon" aria-hidden="true">↗</span> {monster.move} Move</small>}
          {!monster && <small>Monster identity remains in the authoritative battle record.</small>}
        </div>
      </div>
      {outcomes.length > 0 && <ul className="fight-resolution-outcomes" aria-label="Recorded normal fight outcomes">{outcomes.map((outcome, index) => <li key={`${outcome}-${index}`}>{outcome}</li>)}</ul>}
      <p className="fight-resolution-note">Attack order, legal targets, dice, modifiers, damage, smash, destruction, mutation, and the next decision come from the authoritative engine and remain in the phase controls.</p>
    </section>
  );
}

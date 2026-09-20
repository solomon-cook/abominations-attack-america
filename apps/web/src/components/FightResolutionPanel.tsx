import { useEffect, useState, type ReactNode } from "react";
import { GIANT_UNIT_DEFINITIONS, monsterCombatStats, type BattleAttack, type GameState } from "@abominations/game-engine";
import { monsterPortrait, ResolutionStage } from "./ResolutionStage";
import { MutationStrip } from "./MutationStrip";
import { DieCube } from "./DieCube";
import { attackResultLabel, healthAtAttack, healthLost, militaryArt, readBattleAttacks } from "./combat-presentation";
import "../combat-stage.css";

type Props = {
  open: boolean;
  onClose: () => void;
  controls: ReactNode;
  event?: GameState["eventLog"][number];
  game: GameState;
  canAct: boolean;
  pendingBattle?: GameState["pendingBattles"][number];
  pendingAttackTarget?: Extract<NonNullable<GameState["pendingDecision"]>, { type: "attack-target" }>;
  onChooseTarget: (unitId: string, battleId: string, spendInfamy?: number) => void;
};

export function HealthBar({ before, after, maximum, name }: { before: number; after: number; maximum: number; name: string }) {
  const denominator = Math.max(maximum, before, after, 1);
  return <div className="battle-health" aria-label={`${name}: ${before === after ? after : `${before} to ${after}`} Health`}>
    <div className="battle-health-track" aria-hidden="true"><span className="battle-health-lost" style={{ width: `${before / denominator * 100}%` }} /><span style={{ width: `${after / denominator * 100}%` }} /></div>
    <span>♥ {before !== after && <del>{before}</del>} <b>{after}</b><small> / {maximum} Health</small></span>
  </div>;
}

function AttackRoll({ attack, attackerName, targetName, settled }: { attack: BattleAttack; attackerName: string; targetName: string; settled: boolean }) {
  const modifier = attack.rollModifier ?? 0;
  const defense = attack.targetDefense;
  return <section className={`battle-roll ${settled ? "is-settled" : "is-rolling"}`} aria-label={`${attackerName} attacks ${targetName}`}>
    <div className="battle-roll-heading"><span className="resolution-eyebrow">{attackerName} rolls</span><strong>{settled ? attack.smash ? "SMASH!" : attack.hit ? "HIT" : "MISS" : "ROLLING…"}</strong></div>
    <div className="battle-roll-equation"><DieCube value={settled ? attack.roll : 0} label={settled ? `${attackerName} rolls ${attack.roll}` : `${attackerName} is rolling`} /><div className="battle-roll-math">
      <b>{settled ? <>{attack.roll}{modifier !== 0 && <> + {modifier} = {attack.roll + modifier}</>}{defense !== undefined && <span> {attack.hit ? "≥" : "<"} {defense}</span>}</> : "…"}</b>
      <small>{defense !== undefined ? `${targetName} · Defense ${defense}` : `${targetName} · recorded result`}</small>
    </div></div>
    {defense !== undefined && <div className="battle-hit-range" aria-label={`A roll of ${Math.max(1, defense - modifier)} or higher hits`}>
      {[1, 2, 3, 4, 5, 6].map(face => <span key={face} className={`${face + modifier >= defense ? "can-hit" : "would-miss"} ${settled && face === attack.roll ? "rolled" : ""}`}>{face}</span>)}<small>{Math.max(1, defense - modifier)}+ to hit</small>
    </div>}
    <p className="battle-roll-explanation">{!settled ? "The die is in motion." : attack.hit ? attack.destroyed && attack.targetHealthAfter === undefined ? "One hit destroys a normal military unit." : attack.smash ? "Natural 6 · +1 damage before other effects." : `${attack.damage} damage to ${targetName}.` : `${targetName} takes no damage.`}</p>
    {settled && (attack.modifiers?.length ?? 0) > 0 && <div className="battle-modifiers">{attack.modifiers.map(modifier => <span key={modifier}>{modifier}</span>)}</div>}
    {settled && (attack.mutationCardId || attack.antimatterMutationCardId) && <p className="battle-special">✦ Mutation drawn: {attack.mutationCardId ?? attack.antimatterMutationCardId}</p>}
    {settled && attack.antimatterMutationRoll !== undefined && <p className="battle-special">Antimatter mutation check: {attack.antimatterMutationRoll}{attack.antimatterMutationRoll === 1 ? " · mutation triggered" : " · no mutation"}</p>}
    {settled && attack.stabilizerMutationCardId && <p className="battle-special">Stabilizer Ray removed {attack.stabilizerMutationCardId}.</p>}
    {settled && attack.attackerDestroyed && <p className="battle-special">Radiation Field destroyed the attacker.</p>}
  </section>;
}

/** Mount a fresh viewing session on open. Playback never submits or rerolls an attack. */
export function FightResolutionPanel(props: Props) {
  return props.open ? <FightSession {...props} /> : null;
}

function FightSession({ onClose, controls, event, game, canAct, pendingBattle, pendingAttackTarget, onChooseTarget }: Props) {
  const [selectedBattleId, setSelectedBattleId] = useState<string>();
  const [roster, setRoster] = useState(game.pendingBattles);
  useEffect(() => {
    setRoster(previous => {
      const added = game.pendingBattles.filter(battle => !previous.some(saved => saved.id === battle.id));
      return added.length ? [...previous, ...added] : previous;
    });
  }, [game.pendingBattles]);
  const [dismissedEvent, setDismissedEvent] = useState<string>();
  const shownEvent = event?.id === dismissedEvent ? undefined : event;
  const attacks = readBattleAttacks(shownEvent?.detail.attacks);
  const liveBattle = game.pendingBattles.find(battle => battle.id === selectedBattleId) ?? pendingBattle ?? game.pendingBattles.find(battle => battle.id === pendingAttackTarget?.battleId) ?? game.pendingBattles[0];
  const eventBattleId = typeof shownEvent?.detail.battleId === "string" ? shownEvent.detail.battleId : undefined;
  const battleId = eventBattleId ?? liveBattle?.id;
  const battle = roster.find(candidate => candidate.id === battleId) ?? game.pendingBattles.find(candidate => candidate.id === battleId);
  const monster = game.monsters.find(candidate => candidate.id === battle?.monsterId)
    ?? game.monsters.find(candidate => attacks.some(attack => attack.attackerId === candidate.id || attack.targetId === candidate.id));
  const unitIds = new Set([...(battle?.militaryUnitIds ?? []), ...attacks.flatMap(attack => [attack.attackerId, attack.targetId])]);
  const units = game.units.filter(unit => unitIds.has(unit.id));
  const [position, setPosition] = useState({ battleId, received: attacks.length, index: 0 });
  // Multi-target events contain the cumulative history. Start at the first NEW attack.
  if (position.battleId !== battleId || position.received !== attacks.length) {
    setPosition({ battleId, received: attacks.length, index: position.battleId === battleId ? Math.min(position.received, Math.max(0, attacks.length - 1)) : 0 });
  }
  const index = Math.min(position.index, Math.max(0, attacks.length - 1));
  const attack = attacks[index];
  const beatKey = `${shownEvent?.id}-${index}`;
  const [settledBeat, setSettledBeat] = useState("");
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(document.querySelector(".manual-reduced-motion"));
    if (reduced) { setSettledBeat(beatKey); return; }
    const timer = window.setTimeout(() => setSettledBeat(beatKey), 540);
    return () => window.clearTimeout(timer);
  }, [beatKey]);
  const settled = !attack || settledBeat === beatKey;
  const revealedIndex = index - (settled ? 0 : 1);
  const revealed = attacks.slice(0, revealedIndex + 1);
  const destroyed = new Set(revealed.flatMap(item => [ ...(item.destroyed ? [item.targetId] : []), ...(item.attackerDestroyed ? [item.attackerId] : []) ]));
  const atEnd = !attack || (index === attacks.length - 1 && settled);
  const nextBattle = Boolean(atEnd && eventBattleId && liveBattle && liveBattle.id !== eventBattleId);
  const complete = shownEvent?.action === "fight.resolved" && !game.pendingCombat && atEnd;
  const nameFor = (id: string) => {
    const namedMonster = game.monsters.find(candidate => candidate.id === id);
    if (namedMonster) return namedMonster.name;
    const unit = game.units.find(candidate => candidate.id === id);
    const duplicates = units.filter(candidate => candidate.unitTypeId === unit?.unitTypeId);
    const label = (unit?.unitTypeId ?? unit?.branch ?? id).replaceAll("-", " ");
    return duplicates.length > 1 ? `${label} ${duplicates.findIndex(candidate => candidate.id === id) + 1}` : label;
  };
  const monsterAttacking = Boolean(attack && monster && attack.attackerId === monster.id);
  const round = attack?.combatRound ?? pendingAttackTarget?.round;
  const openingStrike = attack?.modifiers?.includes("extra first-round attack before monster");
  const currentPhase = attack ? openingStrike ? "Opening strike" : monsterAttacking ? "Monster attacks" : "Military returns fire" : pendingAttackTarget ? "Choose your target" : "Prepare for battle";
  const advance = (next: number) => setPosition(current => ({ ...current, index: next }));
  const monsterHealth = monster ? healthAtAttack(monster.id, attacks, revealedIndex, monster.health) : 0;
  const monsterBefore = monster && attack?.targetId === monster.id ? attack.targetHealthBefore ?? monsterHealth : monsterHealth;
  const canChoose = (!attack || index === attacks.length - 1) && !nextBattle && game.phase === "fight" && !game.pendingRetreat && Boolean(liveBattle);
  const targetIds = pendingAttackTarget?.targetIds ?? liveBattle?.militaryUnitIds.filter(id => game.units.some(unit => unit.id === id && unit.location === liveBattle.location)) ?? [];
  const nextAttack = attacks[index + 1];
  const targetAction = (id: string) => nextAttack?.targetId === id ? <button className="battle-target-button" disabled={!settled} onClick={() => advance(index + 1)} aria-label={`Continue attack against ${nameFor(id)}`}>Target this {id === monster?.id ? "monster" : "unit"} · reveal roll</button> : canChoose && targetIds.includes(id) && liveBattle ? <div className="battle-target-actions">
    <button className="battle-target-button" disabled={!canAct || !settled} onClick={() => onChooseTarget(id, liveBattle.id)} aria-label={`Roll attack against ${nameFor(id)}`}>Target this unit · roll</button>
    {!pendingAttackTarget && Boolean(monster?.infamy) && <button className="battle-target-button battle-infamy-target" disabled={!canAct || !settled} onClick={() => onChooseTarget(id, liveBattle.id, 1)}>✦ 1 Infamy · target + extra attack</button>}
  </div> : null;
  const title = attack ? complete ? "The dust settles." : "Every strike counts." : "Clash of titans.";


  return <ResolutionStage variant="fight" title={title} eyebrow={`BATTLE / ${monster?.name ?? "MONSTER"} VS MILITARY`} onClose={onClose}>
    <details className="battle-order"><summary>Combat order · two rounds, then aftermath</summary><nav className="battle-rounds" aria-label="Combat order">{[1, 2].map(value => <div key={value} className={round === value ? "is-current" : ""}><b>ROUND {value}</b><span>Monster <i>→</i> surviving military</span></div>)}<div><b>AFTERMATH</b><span>Resolve survivors</span></div></nav></details>
    {!game.pendingCombat && !pendingAttackTarget && game.pendingBattles.length > 1 && atEnd && <nav className="battle-selection" aria-label="Choose battle">{game.pendingBattles.map(candidate => <button key={candidate.id} aria-pressed={candidate.id === liveBattle?.id} onClick={() => { setSelectedBattleId(candidate.id); setDismissedEvent(event?.id); }}>{game.monsters.find(item => item.id === candidate.monsterId)?.name ?? "Monster"} · battle {game.pendingBattles.indexOf(candidate) + 1}</button>)}</nav>}
    <div className="battle-turn"><span>{round ? `ROUND ${round} · ` : ""}{currentPhase}</span><small>{attack ? `Attack ${index + 1} / ${attacks.length}${game.pendingCombat ? " recorded" : ""}` : "One die per attack"}</small></div>
    <div className={`battle-arena ${monsterAttacking ? "monster-strikes" : "military-strikes"}`}>
      <section className={`battle-monster battle-side ${Boolean(attack && monster && attack.attackerId === monster.id) ? "is-attacker" : ""} ${Boolean(attack && monster && attack.targetId === monster.id) ? "is-target" : ""}`} aria-label={monster?.name ?? "Monster"}>
        <span className="battle-role">{Boolean(attack && monster && attack.attackerId === monster.id) ? "ATTACKING" : Boolean(attack && monster && attack.targetId === monster.id) ? "UNDER ATTACK" : "MONSTER"}</span>
        <div className="battle-portrait">{monster && <img src={monsterPortrait(monster.name)} alt={monster.name} />}
          {settled && attack && monster && attack.targetId === monster.id && <strong key={beatKey} className={`battle-impact ${attack.hit ? "damage" : "miss"}`}>{attack.hit ? `−${healthLost(attack) ?? attack.damage} ♥` : "MISS"}</strong>}
        </div>
        <h3>{monster?.name ?? "Choose a battle"}</h3>
        {monster && <><HealthBar before={monsterBefore} after={monsterHealth} maximum={monster.maxHealth} name={monster.name} /><p className="battle-side-meta">✦ {monster.infamy} Infamy · {monsterCombatStats(game, monster).defense} Defense · {monsterCombatStats(game, monster).damage} Damage</p><MutationStrip cards={(game.players[game.monsters.findIndex(candidate => candidate.id === monster.id)]?.visibleMutationCardIds ?? game.players[game.monsters.findIndex(candidate => candidate.id === monster.id)]?.mutationCardIds) ?? []} />{destroyed.has(monster.id) && <span className="battle-unit-status">Defeated · Hollywood</span>}</>}
        {monster && targetAction(monster.id)}
      </section>
      <div className="battle-center"><span className="battle-center-vs">VS</span>
    {attack ? <div className="battle-playback" key={beatKey}>
      <AttackRoll attack={attack} attackerName={nameFor(attack.attackerId)} targetName={nameFor(attack.targetId)} settled={settled} />
      <div className={`battle-consequence ${settled ? "is-visible" : ""}`} aria-live="polite">{settled && <><small>{nameFor(attack.targetId)}</small><strong>{attackResultLabel(attack)}</strong>{attack.targetHealthBefore !== undefined && <span>♥ {attack.targetHealthBefore} → {attack.targetHealthAfter}</span>}{attack.destroyed && attack.targetHealthAfter === undefined && <p>{game.units.find(unit => unit.id === attack.targetId)?.location === "permanently-removed" ? "Removed from play." : "Returns to its military sheet."}</p>}</>}</div>
    </div> : <div className="battle-ready"><strong>{pendingAttackTarget ? `Choose ${monster?.name ?? "the monster"}’s attack ${pendingAttackTarget.attackNumber ?? 1} target.` : "Pick a target. Roll. See the impact."}</strong><DieCube value={6} label="Choose a target to roll" /><p>Match or beat Defense to hit. A natural 6 adds one damage. Destroyed units cannot return fire.</p>{units.some(unit => unit.unitTypeId === "army-missile-launcher") && <p>Missile launchers get an opening strike before the monster.</p>}</div>}
      </div>
      <section className="battle-forces" aria-label={`Military targets · ${units.length} unit${units.length === 1 ? "" : "s"}`}>
        {units.map((unit, unitIndex) => {
          const targeted = attack?.targetId === unit.id;
          const attacking = attack?.attackerId === unit.id;
          const isDestroyed = destroyed.has(unit.id);
          const giant = unit.unitTypeId === "mecha-monster" || unit.unitTypeId === "captain-colossal";
          const health = healthAtAttack(unit.id, attacks, revealedIndex, unit.health);
          return <div key={unit.id} className={`battle-unit battle-side ${targeted ? "is-target" : ""} ${attacking ? "is-attacker" : ""} ${isDestroyed ? "is-destroyed" : ""}`}>
            <span className="battle-role">{isDestroyed ? "DESTROYED" : attacking ? "ATTACKING" : targeted ? "UNDER ATTACK" : `UNIT ${unitIndex + 1}`}</span>
            <div className="battle-portrait">{militaryArt(unit.unitTypeId) && <img src={militaryArt(unit.unitTypeId)} alt="" />}
              {targeted && settled && <strong key={beatKey} className={`battle-impact ${attack.hit ? "damage" : "miss"}`}>{isDestroyed ? "✕" : attack.hit ? `−${healthLost(attack) ?? attack.damage} ♥` : "MISS"}</strong>}
            </div>
            <h3>{nameFor(unit.id)}</h3>
            {giant ? <HealthBar name={nameFor(unit.id)} before={targeted ? attack.targetHealthBefore ?? health : health} after={health} maximum={GIANT_UNIT_DEFINITIONS.find(definition => definition.id === unit.unitTypeId)?.health ?? health} /> : <span className="battle-unit-status">{isDestroyed ? "Destroyed · cannot return fire" : "One hit destroys"}</span>}
            <p className="battle-side-meta">◈ {unit.defense} Defense · {unit.damage} Damage</p>
            {targetAction(unit.id)}
          </div>;
        })}
        {!units.length && <p className="battle-empty">Select a battle below.</p>}
      </section>
    </div>
    {units.length > 1 && <p className="battle-roster-hint">{units.length} military units · choose a target to roll</p>}

    {attacks.length > 0 && <>
      <div className="battle-playback-controls"><button disabled={index === 0} onClick={() => advance(index - 1)}>← Previous result</button><span>{!settled ? "Resolving roll…" : nextAttack ? `Next: ${nameFor(nextAttack.attackerId)} attacks. Click ${nameFor(nextAttack.targetId)} to reveal the roll.` : "All recorded attacks shown"}</span></div>
      <details className="battle-history"><summary>Attack sequence · {attacks.length} rolls</summary><ol>{attacks.map((item, step) => <li key={step}><button aria-current={step === index ? "step" : undefined} onClick={() => advance(step)}><span>{item.combatRound ? `R${item.combatRound}` : "—"}</span><b>{nameFor(item.attackerId)} → {nameFor(item.targetId)}</b><span>⚄ {item.roll} · {attackResultLabel(item)}</span></button></li>)}</ol></details>
    </>}
    {atEnd && <div className="battle-next">
      {complete && <div className="battle-summary"><strong>{monster?.health === 0 ? `${monster.name} is sent to Hollywood.` : destroyed.size ? `${units.filter(unit => destroyed.has(unit.id)).length} military unit${units.filter(unit => destroyed.has(unit.id)).length === 1 ? "" : "s"} destroyed.` : "Combat rounds complete."}</strong>{units.length > 0 && units.every(unit => destroyed.has(unit.id)) && !attacks.some(item => item.targetId === monster?.id) && <p>All units fell before they could return fire. {monster?.name} took no damage from military attacks.</p>}</div>}
      {nextBattle ? <button className="cinema-primary" onClick={() => setDismissedEvent(event?.id)}>Continue to next battle →</button> : game.phase === "fight" ? <div className="cinema-battle-actions">{pendingAttackTarget && <p>Next: choose a target for attack {pendingAttackTarget.attackNumber ?? 1}{pendingAttackTarget.attackTotal ? ` of ${pendingAttackTarget.attackTotal}` : ""}.</p>}{controls}</div> : <button className="cinema-primary" onClick={onClose}>Continue to board →</button>}
    </div>}
  </ResolutionStage>;
}

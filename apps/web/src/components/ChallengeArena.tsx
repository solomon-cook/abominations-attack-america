import { useEffect, useRef, useState } from "react";
import { GIANT_UNIT_DEFINITIONS, monsterCombatStats, type GameCommand, type GameState } from "@abominations/game-engine";
import { DieCube } from "./DieCube";
import { MutationStrip } from "./MutationStrip";
import { monsterPortrait, ResolutionStage } from "./ResolutionStage";
import { HealthBar } from "./FightResolutionPanel";
import { militaryArt, readBattleAttacks } from "./combat-presentation";
import { ChallengeMutationControls } from "./ChallengeMutationControls";
import "../combat-stage.css";

type Props = { game: GameState; canAct: boolean; canUseMutation?: boolean; playerIndex?: number; runCommand: (command: GameCommand) => void | Promise<void>; onClose: () => void; error?: string };

export function ChallengeArena({ game, canAct, canUseMutation = canAct, playerIndex, runCommand, onClose, error }: Props) {
  const event = game.eventLog.at(-1);
  const [settledId, setSettledId] = useState<string>();
  const [acknowledged, setAcknowledged] = useState<string>();
  const attack = event?.action.startsWith("challenge.") && acknowledged !== event.id ? readBattleAttacks(event.detail.attacks).at(-1) : undefined;
  const [recoveredId, setRecoveredId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(document.querySelector(".manual-reduced-motion"));
    const timer = window.setTimeout(() => setSettledId(event?.id), reduced ? 0 : 950);
    const recoveryTimer = window.setTimeout(() => setRecoveredId(event?.id), reduced ? 0 : 1550);
    return () => { window.clearTimeout(timer); window.clearTimeout(recoveryTimer); };
  }, [event?.id]);
  const settled = !attack || settledId === event?.id;
  const completed = Boolean(event?.action === "challenge.resolved" || event?.action === "challenge.giant.resolved");
  const showResult = completed && acknowledged !== event?.id;
  const decision = game.pendingDecision;
  const choosing = !showResult && (decision?.type === "challenge-opponent" || decision?.type === "challenge-giant");
  const challenge = game.challenge;
  const leftId = showResult ? String(event?.detail.challengerMonsterId) : challenge?.challengerMonsterId;
  const rightId = showResult ? String(event?.detail.opponentMonsterId ?? event?.detail.giantUnitId) : challenge?.opponentMonsterId ?? challenge?.giantUnitId;
  const combatant = (id?: string) => game.monsters.find(monster => monster.id === id) ?? game.units.find(unit => unit.id === id);
  const left = combatant(leftId);
  const right = combatant(rightId);
  const challengerHasPriority = left && "name" in left && game.players[game.monsters.findIndex(monster => monster.id === left.id)]?.mutationCardIds.includes("High-Octane Blood");
  const opponentHasPriority = right && "name" in right && game.players[game.monsters.findIndex(monster => monster.id === right.id)]?.mutationCardIds.includes("High-Octane Blood");
  const first = opponentHasPriority && !challengerHasPriority ? right : left;
  const attackerId = challenge?.turn?.attackerId ?? first?.id;
  const attacker = combatant(attackerId);
  const name = (id?: string) => { const unit = combatant(id); return unit ? "name" in unit ? unit.name : (unit.unitTypeId ?? unit.id).replaceAll("-", " ") : "Opponent"; };
  const resolving = decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution";
  const remaining = challenge?.turn?.remainingAttacks ?? attacker?.attacks ?? 0;
  const canSpend = attacker && "infamy" in attacker && attacker.infamy > 0 && Boolean(challenge?.turn?.attacks.length);
  const recovered = !completed || recoveredId === event?.id;
  const disabled = !canAct || busy || !settled;
  const send = async (command: GameCommand, allowed = canAct) => {
    if (submitting.current || !allowed || busy || !settled) return;
    submitting.current = true; setBusy(true);
    try { await runCommand(command); } finally { submitting.current = false; setBusy(false); }
  };
  const options = decision?.type === "challenge-opponent" ? decision.opponentIds : decision?.type === "challenge-giant" ? decision.giantUnitIds : [];
  const stats = (unit: NonNullable<typeof left>) => "name" in unit ? monsterCombatStats(game, unit, challenge?.turn?.round ?? 1) : unit;
  const healthSnapshot = (key: "healthBeforeAttack" | "healthAfterAttack", id: string, fallback: number) => {
    const snapshot = event?.detail[key];
    const value = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>)[id] : undefined;
    return typeof value === "number" ? value : fallback;
  };
  const title = showResult && settled ? `${String(event?.detail.winnerName ?? name(leftId))} wins.` : choosing ? "Who’s next?" : "Clash of titans.";
  return <ResolutionStage title={title} eyebrow="THE FINAL MONSTER CHALLENGE" variant="challenge" onClose={onClose}>
    <div className="challenge-live-turn" aria-live="polite">{showResult ? settled ? game.phase === "game-over" ? game.victoryType === "america-saved" ? "America is saved" : "King of the Giant Monsters" : "A challenger survives" : "The final strike…" : choosing ? "Choose the next opponent" : `Round ${challenge?.turn?.round ?? 1} · ${name(attackerId)}’s turn`}</div>
    <ChallengeMutationControls game={game} canUseMutation={canUseMutation} playerIndex={playerIndex} disabled={busy || !settled} runCommand={(command) => send(command, canUseMutation)} />
    <div className="challenge-live-arena">
      {[left, right].map((unit, index) => <section key={index} className={`challenge-live-side ${unit?.id === attackerId && !showResult ? "is-attacker" : ""}`}>
        <span className="battle-role">{index === 0 ? "CHALLENGER" : "OPPONENT"}</span>
        <div className="challenge-live-portrait">{unit ? <img src={"name" in unit ? monsterPortrait(unit.name) : militaryArt(unit.unitTypeId)} alt={name(unit.id)} /> : <span className="challenge-silhouette">?</span>}
          {attack && settled && unit?.id === attack.targetId && <strong key={event?.id} className={`battle-impact ${attack.hit ? "damage" : "miss"}`}>{attack.hit ? `−${attack.targetHealthBefore! - attack.targetHealthAfter!} ♥` : "MISS"}</strong>}
        </div>
        <h3>{unit ? name(unit.id) : "Choose your rival"}</h3>
        {unit && <>
          <HealthBar name={name(unit.id)} before={attack ? healthSnapshot("healthBeforeAttack", unit.id, unit.health) : unit.health} after={!settled ? healthSnapshot("healthBeforeAttack", unit.id, unit.health) : !recovered ? healthSnapshot("healthAfterAttack", unit.id, unit.health) : unit.health} maximum={"maxHealth" in unit ? unit.maxHealth : GIANT_UNIT_DEFINITIONS.find(def => def.id === unit.unitTypeId)?.health ?? unit.health} />
          <p className="battle-side-meta">{stats(unit).defense} Defense · {stats(unit).damage} Damage{"infamy" in unit && <> · ✦ {unit.infamy} Infamy</>}</p>
          {"name" in unit && <MutationStrip cards={(game.players[game.monsters.findIndex(monster => monster.id === unit.id)]?.visibleMutationCardIds ?? game.players[game.monsters.findIndex(monster => monster.id === unit.id)]?.mutationCardIds) ?? []} />}
          {!choosing && !showResult && resolving && unit.id !== attackerId && <div className="battle-target-actions">
            {remaining > 0 && <button className="battle-target-button" disabled={disabled} onClick={() => void send({ type: "resolve-challenge" })} aria-label={`Roll attack against ${name(unit.id)}`}>Target this monster · roll</button>}
            {canSpend && <button className="battle-target-button battle-infamy-target" disabled={disabled} onClick={() => void send({ type: "resolve-challenge", spendInfamy: true })}>✦ 1 Infamy · target again</button>}
          </div>}
        </>}
      </section>)}
      <div className="challenge-live-vs" aria-hidden="true">VS</div>
    </div>
    <div className="challenge-table" aria-busy={busy || !settled}>
      {choosing ? <div className="challenge-opponents">{options.map(id => { const unit = combatant(id); return <button key={id} disabled={disabled} onClick={() => void send(decision?.type === "challenge-opponent" ? { type: "challenge-opponent", opponentMonsterId: id } : { type: "challenge-giant", giantUnitId: id })}>
        {unit && <img src={"name" in unit ? monsterPortrait(unit.name) : militaryArt(unit.unitTypeId)} alt="" />}<strong>{name(id)}</strong><span>♥ {unit?.health}{unit && "infamy" in unit ? ` · ✦ ${unit.infamy}` : ""}</span>
      </button>; })}</div> : <>
        <div className="challenge-dice-action">
          <div className={`roll-die-button combat-die-display ${!settled ? "is-rolling" : ""}`}>
            <DieCube value={settled ? attack?.roll ?? 6 : 0} label={settled && attack ? `Rolled ${attack.roll}` : "Choose the defending monster to roll"} />
          </div>
          <div aria-live="polite"><strong>{!settled ? "Rolling…" : attack ? attack.smash ? "SMASH!" : attack.hit ? "A direct hit." : "Miss!" : challenge?.turn?.attacks.length ? "Your turn to roll." : "Take the first roll."}</strong><p>{!settled ? "The die is in motion." : attack ? `${name(attack.attackerId)} rolled ${attack.roll} against ${attack.targetDefense} Defense.` : `${name(attackerId)} ${challenge?.turn?.attacks.length ? "has the dice" : "attacks first"}.`}</p>{settled && attack?.retaliationDamage ? <p>It's a Robot! · attacker loses {attack.retaliationDamage} Health.</p> : null}</div>
        </div>
        {showResult ? settled && <div className="challenge-turn-actions">
          {typeof event?.detail.loserWeighIn === "number" && <p>{recovered ? "Recovered" : "Recovering"} {String(event.detail.healthRecovered ?? event.detail.loserWeighIn)} Health from the opponent’s weigh-in.</p>}
          <button className="cinema-primary" disabled={!recovered} onClick={() => game.phase === "game-over" ? onClose() : setAcknowledged(event?.id)}>{game.phase === "game-over" ? "Finish challenge" : "Choose next opponent →"}</button>
        </div> : <div className="challenge-turn-actions">
          <p>{!canAct ? `Waiting for Player ${(decision?.playerIndex ?? game.currentPlayer) + 1} · ${name(attackerId)}` : remaining > 0 ? `Choose the defending monster · ${remaining} attack${remaining === 1 ? "" : "s"} remaining` : "Keep fighting, or hand over the dice."}</p>
          {remaining === 0 && <button className="cinema-primary" disabled={disabled} onClick={() => void send({ type: "resolve-challenge", endTurn: true })}>Pass dice to {name(attackerId === leftId ? rightId : leftId)} →</button>}
        </div>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
    <details className="battle-history"><summary>Battle rules & roll history</summary><p>Match Defense to hit. A natural 6 adds one damage. Spend one Infamy for each extra attack, after seeing the previous roll. The survivor recovers the defeated monster’s weigh-in Health and chooses the next opponent.</p>
      <ol>{(challenge?.turn?.attacks ?? readBattleAttacks(event?.detail.duelAttacks)).slice(0, settled ? undefined : -1).map((item, i) => <li key={i}>Round {item.combatRound} · {name(item.attackerId)} · ⚄ {item.roll} · {item.hit ? `${item.damage} damage` : "Miss"}{item.modifiers.length ? ` · ${item.modifiers.join(" · ")}` : ""}</li>)}</ol>
    </details>
  </ResolutionStage>;
}

import { useEffect, useState, type ReactNode } from "react";
import { monsterPortrait, ResolutionStage } from "./ResolutionStage";
import type { GameState } from "@abominations/game-engine";
import { DieCube } from "./DieCube";

type Props = {
  open: boolean;
  onClose: () => void;
  controls: ReactNode;
  eventId?: string;
  game: GameState;
  canAct: boolean;
  pendingBattle?: GameState["pendingBattles"][number];
  pendingAttackTarget?: Extract<NonNullable<GameState["pendingDecision"]>, { type: "attack-target" }>;
  rolls: readonly number[];
  outcomes: readonly string[];
};

export function FightResolutionPanel({ open, onClose, controls, eventId, game, canAct, pendingBattle, pendingAttackTarget, rolls, outcomes }: Props) {
  const battle = pendingBattle ?? game.pendingBattles.find(candidate => candidate.id === pendingAttackTarget?.battleId) ?? game.pendingBattles[0];
  const [lastBattle, setLastBattle] = useState<GameState["pendingBattles"][number] | undefined>(battle);
  const [lastUnits, setLastUnits] = useState(game.units);
  useEffect(() => { if (open && battle) { setLastBattle(battle); setLastUnits(game.units); } else if (!open) { setLastBattle(undefined); } }, [battle, game.units, open]);
  const shownBattle = battle ?? lastBattle;
  const monster = game.monsters.find(candidate => candidate.id === shownBattle?.monsterId);
  const units = (battle ? game.units : lastUnits).filter(unit => shownBattle?.militaryUnitIds.includes(unit.id));
  if (!open) return null;
  return <ResolutionStage variant="fight" title={game.phase === "fight" ? "Clash of titans." : "The dust settles."} eyebrow="BATTLE / MONSTER VS MILITARY" onClose={onClose}>
    <div className="cinema-versus">
      <section className="cinema-combatant"><p className="resolution-eyebrow">THE ABOMINATION</p>{monster && <img className="cinema-fighter-art" src={monsterPortrait(monster.name)} alt={monster.name} />}<h3>{monster?.name ?? "Choose a battle"}</h3>{monster && <p className="cinema-stats"><span>♥ <b>{monster.health}</b> / {monster.maxHealth} Health</span><span>✦ <b>{monster.infamy}</b> Infamy</span></p>}</section>
      <div className="cinema-vs" aria-label="versus">VS<small>{canAct ? "YOUR DECISION" : "STAND BY"}</small></div>
      <section className="cinema-combatant cinema-military"><p className="resolution-eyebrow">THE LAST LINE OF DEFENSE</p><div className="cinema-unit-art">{units.map(unit => <div key={unit.id}>{unit.unitTypeId && <img src={unit.unitTypeId === "mecha-monster" || unit.unitTypeId === "captain-colossal" ? `/assets/cards/military-research-${unit.unitTypeId}.webp` : `/assets/military/${unit.unitTypeId === "navy-nuclear-submarine-missile" ? "navy-launched-cruise-missile" : unit.unitTypeId}.webp`} alt="" />}<strong>{(unit.unitTypeId ?? unit.branch).replaceAll("-", " ")}</strong><small>{unit.attacks} attacks · {unit.damage} damage · {unit.defense} defense</small></div>)}</div><h3>Military forces</h3><p>{units.length} units engaged</p></section>
    </div>
    <section className="cinema-battle-console" aria-live="polite"><div className="cinema-battle-result" key={eventId}><p className="resolution-eyebrow">{rolls.length ? "COMBAT ROLL" : "AWAITING THE FIRST STRIKE"}</p><div className="combat-roll-list cinema-dice">{rolls.map((roll, index) => <DieCube key={index} value={roll} label={`Fight roll ${index + 1}: ${roll}`} />)}</div>{outcomes.length > 0 && <ul>{outcomes.map((outcome, index) => <li key={index}>{outcome}</li>)}</ul>}</div><div className="cinema-battle-actions">{game.phase === "fight" ? controls : <><h3>Battle resolved</h3><button className="cinema-primary" onClick={onClose}>Continue to board →</button></>}</div></section>
  </ResolutionStage>;
}

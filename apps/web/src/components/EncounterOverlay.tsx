import { useEffect, useState } from "react";
import { DieCube } from "./DieCube";
import { CardReveal, monsterPortrait, ResolutionStage } from "./ResolutionStage";

type Effect = Readonly<{ type: string; amount: number; source: string }>;
type MutationDraw = Readonly<{ siteId: string; cardDrawn: boolean; effectStatus: "implemented" | "source-gated" | "none" }>;
type Props = {
  error?: string;
  open: boolean;
  canAct: boolean;
  monsterName: string;
  locationName: string;
  eventId?: string;
  baselineEventId?: string;
  effects: readonly Effect[];
  rolls: readonly number[];
  choices: readonly string[];
  mutationDraws: readonly MutationDraw[];
  mutationCardId?: string;
  onReveal: () => void;
  onChoice: (choice: "health" | "infamy") => void;
  onClose: () => void;
};

export function EncounterOverlay({ error, open, canAct, monsterName, locationName, eventId, baselineEventId, effects, rolls, choices, mutationDraws, mutationCardId, onReveal, onChoice, onClose }: Props) {
  const resolved = Boolean(eventId && eventId !== baselineEventId);
  const [revealedRolls, setRevealedRolls] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  useEffect(() => { setRevealedRolls(0); setCardRevealed(false); }, [eventId, open]);
  const allRollsShown = revealedRolls >= rolls.length;
  const hasCard = mutationDraws.some(draw => draw.cardDrawn) && Boolean(mutationCardId);
  if (!open) return null;
  return <ResolutionStage title={resolved ? "Leave your mark." : "Something stirs."} eyebrow={`ENCOUNTER / ${locationName}`} onClose={onClose}>
    <div className={`cinema-encounter ${hasCard && resolved ? "has-card" : ""}`}>
      <aside className="cinema-monster"><img src={monsterPortrait(monsterName)} alt={monsterName} /><div><p className="resolution-eyebrow">THE ABOMINATION</p><h3>{monsterName}</h3><p>{locationName}</p></div></aside>
      <section className="cinema-event" aria-live="polite">
        {error && <p role="alert">{error}</p>}
        {!resolved ? <div className="cinema-intro"><p className="resolution-eyebrow">UNCHARTED CONSEQUENCES</p><h3>Make your<br />presence felt.</h3><p>A reward. A mutation. A twist of fate.<br />Discover what this space holds.</p><button className="cinema-primary" disabled={!canAct} onClick={onReveal}>Reveal encounter <span aria-hidden="true">↗</span></button></div> : <>
          {allRollsShown && choices.length > 0 && <div className="cinema-choice"><p className="resolution-eyebrow">CHOOSE YOUR REWARD</p><h3>Grow stronger.</h3><div>{choices.map(choice => <button className="cinema-primary" key={choice} disabled={!canAct} onClick={() => onChoice(choice as "health" | "infamy")}>{choice === "health" ? "♥ Take Health" : "✦ Take 2 Infamy"}</button>)}</div></div>}
          {rolls.length > 0 && <div className="cinema-roll-stage"><p className="resolution-eyebrow">FATE IN MOTION · {revealedRolls} / {rolls.length}</p><div className="combat-roll-list cinema-dice">{rolls.slice(0, revealedRolls).map((roll, index) => <DieCube key={`${eventId}-${index}`} value={roll} label={`Encounter roll ${index + 1}: ${roll}`} />)}</div>{!allRollsShown && <button className="cinema-primary" onClick={() => setRevealedRolls(count => count + 1)}>Roll die {revealedRolls + 1} <span aria-hidden="true">⚄</span></button>}</div>}
          {allRollsShown && hasCard && <CardReveal key={eventId} cardId={mutationCardId!} onRevealed={() => setCardRevealed(true)} />}
          {allRollsShown && (!hasCard || cardRevealed) && <div className="cinema-rewards">{effects.filter(effect => effect.type === "health" || effect.type === "infamy").map((effect, index) => <div className={`cinema-reward reward-${effect.type}`} key={`${eventId}-${index}`}><span aria-hidden="true">{effect.type === "health" ? "♥" : "✦"}</span><strong>{effect.amount > 0 ? "+" : ""}{effect.amount}</strong><div><b>{effect.type}</b><small>{effect.source}</small></div></div>)}</div>}
          {allRollsShown && !choices.length && (!hasCard || cardRevealed) && <button className="cinema-primary" onClick={onClose}>Return to board →</button>}
        </>}
      </section>
    </div>
  </ResolutionStage>;
}

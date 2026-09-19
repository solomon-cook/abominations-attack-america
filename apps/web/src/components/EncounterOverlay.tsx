import { useEffect, useMemo, useState } from "react";
import { sourcedCardRule } from "@abominations/game-engine";
import { DieCube } from "./DieCube";
import { mutationArt } from "./MutationStrip";

type Effect = Readonly<{ type: string; amount: number; source: string }>;
type MutationDraw = Readonly<{ siteId: string; cardDrawn: boolean; effectStatus: "implemented" | "source-gated" | "none" }>;
type Props = {
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

export function EncounterOverlay({ open, canAct, monsterName, locationName, eventId, baselineEventId, effects, rolls, choices, mutationDraws, mutationCardId, onReveal, onChoice, onClose }: Props) {
  const resolved = Boolean(eventId && eventId !== baselineEventId);
  const [revealedRolls, setRevealedRolls] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  useEffect(() => { if (open) { setRevealedRolls(0); setCardRevealed(false); } }, [eventId, open]);
  const allRollsShown = revealedRolls >= rolls.length;
  const mutationSiteDrawn = mutationDraws.some((draw) => draw.cardDrawn);
  const effectHeadline = useMemo(() => effects.find((effect) => effect.type === "infamy" || effect.type === "health"), [effects]);
  if (!open) return null;
  return <div className="encounter-overlay" role="dialog" aria-modal="true" aria-label="Encounter resolution">
    <section className={`encounter-modal ${resolved ? "is-resolved" : "is-ready"}`}>
      <button className="encounter-close" type="button" onClick={onClose} aria-label="Close encounter">×</button>
      <p className="encounter-kicker">ENCOUNTER · {locationName}</p>
      <div className="encounter-modal-heading"><div><h2>{resolved ? "Encounter revealed" : "A new encounter"}</h2><p>{monsterName} is at {locationName}.</p></div><span className="encounter-sigil" aria-hidden="true">✦</span></div>
      {!resolved ? <div className="encounter-ready-state"><div className="encounter-space-preview" aria-hidden="true"><span>◆</span><small>THE BOARD<br />REMEMBERS</small></div><p>Resolve this space to reveal its reward, roll, or mutation.</p><button className="encounter-primary" type="button" disabled={!canAct} onClick={onReveal}>Reveal encounter</button></div> : <>
        {choices.length > 0 && <div className="encounter-choice-stage"><p><strong>Choose the reward</strong><span>This choice is part of the encounter; pick one to continue.</span></p><div className="encounter-choice-buttons">{choices.map((choice) => <button key={choice} type="button" disabled={!canAct} onClick={() => onChoice(choice as "health" | "infamy")}>{choice === "health" ? "Take Health" : "Take 2 Infamy"}</button>)}</div></div>}
        {rolls.length > 0 && <div className="encounter-roll-stage"><div className="encounter-stage-label"><span>ENCOUNTER ROLL</span><small>{revealedRolls} / {rolls.length} revealed</small></div><div className="encounter-rolls">{rolls.slice(0, revealedRolls).map((roll, index) => <DieCube key={`${eventId}-${index}`} value={roll} label={`Encounter roll ${index + 1}: ${roll}`} />)}{!allRollsShown && <button className="encounter-roll-button" type="button" onClick={() => setRevealedRolls((count) => count + 1)}>Roll die {revealedRolls + 1}</button>}</div></div>}
        {mutationSiteDrawn && <div className={`encounter-mutation-stage ${cardRevealed ? "card-revealed" : ""}`}><div className="encounter-stage-label"><span>MUTATION SITE</span><small>{cardRevealed ? "Mutation acquired" : "A card was drawn face down"}</small></div>{mutationCardId && cardRevealed ? <div className="encounter-card-reveal"><img src={mutationArt(mutationCardId)} alt={`${mutationCardId} mutation card`} /><div><strong>{mutationCardId}</strong><p>{sourcedCardRule(mutationCardId)?.transcription ?? "Mutation effect recorded."}</p></div></div> : <button className="encounter-card-back" type="button" onClick={() => setCardRevealed(true)}><span>?</span><small>Spin to reveal mutation</small></button>}</div>}
        {effectHeadline && <p className="encounter-result-headline">{effectHeadline.type === "infamy" ? "Infamy rises." : "Health surges."} <strong>+{effectHeadline.amount}</strong></p>}
        {(allRollsShown || rolls.length === 0) && !choices.length && (!mutationSiteDrawn || cardRevealed || !mutationCardId) && <button className="encounter-primary" type="button" onClick={onClose}>Return to board</button>}
      </>}
    </section>
  </div>;
}

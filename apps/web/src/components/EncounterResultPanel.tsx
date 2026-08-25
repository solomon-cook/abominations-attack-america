type EncounterEffect = Readonly<{ type: string; amount: number; source: string }>;

type Props = {
  eventId?: string;
  effects: readonly EncounterEffect[];
  rolls: readonly number[];
  choices: readonly string[];
  stomped?: boolean;
  remainingStompMarkers?: number;
  nextPhase?: string;
};

function effectLabel(effect: EncounterEffect) {
  const amount = effect.amount === 1 ? "1" : String(effect.amount);
  if (effect.type === "health") return `+${amount} Health from ${effect.source}`;
  if (effect.type === "infamy") return `+${amount} Infamy from ${effect.source}`;
  if (effect.type === "stomp") return "Stomp marker placed";
  return `${effect.type} effect recorded (${amount})`;
}

export function EncounterResultPanel({ eventId, effects, rolls, choices, stomped, remainingStompMarkers, nextPhase }: Props) {
  if (!eventId) return null;
  return (
    <section className="encounter-result" key={eventId} aria-live="polite" aria-label="Recorded encounter result">
      <span className="label">LAST ENCOUNTER</span>
      {choices.length > 0 && <p className="encounter-choice-note">A source-backed choice is required before the encounter can continue: {choices.join(" or ")}.</p>}
      {rolls.length > 0 && <div className="combat-roll-list encounter-roll-list" aria-label="Recorded encounter dice rolls">
        {rolls.map((roll, index) => <span className={`combat-die show-${roll}`} key={`${eventId}-roll-${index}`} aria-label={`Encounter roll ${index + 1}: ${roll}`}>
          <span className="die-cube" aria-hidden="true">
            <img className="die-cube-face face-front" src="/assets/dice/d6-face-1.webp" alt="" />
            <img className="die-cube-face face-back" src="/assets/dice/d6-face-6.webp" alt="" />
            <img className="die-cube-face face-right" src="/assets/dice/d6-face-2.webp" alt="" />
            <img className="die-cube-face face-left" src="/assets/dice/d6-face-5.webp" alt="" />
            <img className="die-cube-face face-top" src="/assets/dice/d6-face-3.webp" alt="" />
            <img className="die-cube-face face-bottom" src="/assets/dice/d6-face-4.webp" alt="" />
          </span>
          <span className="die-value">{roll}</span>
        </span>)}
      </div>}
      {effects.length > 0 ? (
        <ul className="encounter-effects">{effects.map((effect, index) => <li key={`${eventId}-effect-${index}`}>{effectLabel(effect)}</li>)}</ul>
      ) : choices.length === 0 ? (
        <p className="encounter-no-effect">No active encounter reward was applied; any gated or skipped effect remains recorded in the turn log.</p>
      ) : null}
      {typeof stomped === "boolean" && <p className="encounter-state">{stomped ? "The space consumed a Stomp marker." : "The space was already stomped; no new Stomp marker was consumed."}</p>}
      {typeof remainingStompMarkers === "number" && <p className="encounter-state">{remainingStompMarkers} Stomp marker{remainingStompMarkers === 1 ? "" : "s"} remain; the engine enforces the Infamy cap and marker limits.</p>}
      {nextPhase && <small>Next authoritative phase: {nextPhase}.</small>}
    </section>
  );
}

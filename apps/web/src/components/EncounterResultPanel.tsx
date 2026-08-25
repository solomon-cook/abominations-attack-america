type EncounterEffect = Readonly<{ type: string; amount: number; source: string }>;

type Props = {
  eventId?: string;
  effects: readonly EncounterEffect[];
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

export function EncounterResultPanel({ eventId, effects, choices, stomped, remainingStompMarkers, nextPhase }: Props) {
  if (!eventId) return null;
  return (
    <section className="encounter-result" key={eventId} aria-live="polite" aria-label="Recorded encounter result">
      <span className="label">LAST ENCOUNTER</span>
      {choices.length > 0 && <p className="encounter-choice-note">A source-backed choice is required before the encounter can continue: {choices.join(" or ")}.</p>}
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

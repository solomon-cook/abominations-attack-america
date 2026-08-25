import { DieCube } from "./DieCube";

type EncounterEffect = Readonly<{ type: string; amount: number; source: string }>;

type Props = {
  eventId?: string;
  effects: readonly EncounterEffect[];
  rolls: readonly number[];
  choices: readonly string[];
  stomped?: boolean;
  remainingStompMarkers?: number;
  challenge?: Readonly<{ declared: boolean; active: boolean; challengerMonsterId?: string; pendingStartPlayerIndex: number; startAtEndOfTurn?: boolean }>;
  nextPhase?: string;
};

function effectLabel(effect: EncounterEffect) {
  const amount = effect.amount === 1 ? "1" : String(effect.amount);
  if (effect.type === "health") return `+${amount} Health from ${effect.source}`;
  if (effect.type === "infamy") return `+${amount} Infamy from ${effect.source}`;
  if (effect.type === "stomp") return "Stomp marker placed";
  return `${effect.type} effect recorded (${amount})`;
}

export function EncounterResultPanel({ eventId, effects, rolls, choices, stomped, remainingStompMarkers, challenge, nextPhase }: Props) {
  if (!eventId) return null;
  return (
    <section className="encounter-result" key={eventId} aria-live="polite" aria-label="Recorded encounter result">
      <span className="label">LAST ENCOUNTER</span>
      {choices.length > 0 && <p className="encounter-choice-note">A source-backed choice is required before the encounter can continue: {choices.join(" or ")}.</p>}
      {rolls.length > 0 && <div className="combat-roll-list encounter-roll-list" aria-label="Recorded encounter dice rolls">
        {rolls.map((roll, index) => <DieCube key={`${eventId}-roll-${index}`} value={roll} label={`Encounter roll ${index + 1}: ${roll}`} />)}
      </div>}
      {effects.length > 0 ? (
        <ul className="encounter-effects">{effects.map((effect, index) => <li key={`${eventId}-effect-${index}`}>{effectLabel(effect)}</li>)}</ul>
      ) : choices.length === 0 ? (
        <p className="encounter-no-effect">No active encounter reward was applied; any gated or skipped effect remains recorded in the turn log.</p>
      ) : null}
      {typeof stomped === "boolean" && <p className="encounter-state">{stomped ? "The space consumed a Stomp marker." : "The space was already stomped; no new Stomp marker was consumed."}</p>}
      {typeof remainingStompMarkers === "number" && <p className="encounter-state">{remainingStompMarkers} Stomp marker{remainingStompMarkers === 1 ? "" : "s"} remain; the engine enforces the Infamy cap and marker limits.</p>}
      {challenge?.declared && <p className="encounter-state">Monster Challenge: {challenge.active ? "active" : challenge.startAtEndOfTurn ? "new challenger starts at the end of this turn" : challenge.challengerMonsterId ? "challenger scheduled for their next turn" : "waiting for an eligible Challenge-site arrival"}.</p>}
      {nextPhase && <small>Next authoritative phase: {nextPhase}.</small>}
    </section>
  );
}

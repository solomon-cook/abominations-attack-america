import { DieCube } from "./DieCube";

type Props = {
  action: string;
  description: string;
  rulesHelp: { readonly title: string; readonly body: string };
  unavailableReason: string;
  canAct: boolean;
  lastFightEventId?: string;
  lastFightRolls: readonly number[];
  lastFightOutcomes: readonly string[];
  hollywoodResearchAwarded?: boolean;
  lastRecoveryEventId?: string;
  lastRecoveryRoll?: number;
  lastRecoveryReleased?: boolean;
  lastAtomicRecovery?: boolean;
};

export function TurnPrompt({ action, description, rulesHelp, unavailableReason, canAct, lastFightEventId, lastFightRolls, lastFightOutcomes, hollywoodResearchAwarded, lastRecoveryEventId, lastRecoveryRoll, lastRecoveryReleased, lastAtomicRecovery }: Props) {
  return (
    <>
      <span className="label">CURRENT STEP</span>
      <h2>{action}</h2>
      <p>{description}</p>
      <details className="decision-rules-help"><summary>Rules for this step</summary>
        <span className="label">DECISION HELP</span>
        <strong>{rulesHelp.title}</strong>
        <p>{rulesHelp.body}</p>
      </details>
      {unavailableReason && !canAct && <p className="unavailable-reason" role="status">{unavailableReason}</p>}
      {action === "Fight" && lastFightEventId && lastFightRolls.length > 0 && (
        <div className="combat-result" key={lastFightEventId} aria-live="polite">
          <span className="label">LAST COMBAT ROLLS</span>
          <div className="combat-roll-list">
            {lastFightRolls.map((roll, index) => <DieCube key={`${lastFightEventId}-${index}`} value={roll} label={`Roll ${index + 1}: ${roll}`} />)}
          </div>
          {lastFightOutcomes.length > 0 && <ul className="combat-outcomes">{lastFightOutcomes.map((outcome, index) => <li key={`${lastFightEventId}-outcome-${index}`}>{outcome}</li>)}</ul>}
          {hollywoodResearchAwarded && <small>A rival player drew one Military Research card for sending the monster to Hollywood.</small>}
          <small>Fight result recorded.</small>
        </div>
      )}
      {action === "Move" && lastRecoveryEventId && (typeof lastRecoveryRoll === "number" || lastAtomicRecovery) && (
        <div className="combat-result recovery-result" key={lastRecoveryEventId} aria-live="polite">
          <span className="label">{lastAtomicRecovery ? "TURN-START RECOVERY" : "LAST HOLLYWOOD RECOVERY"}</span>
          {lastAtomicRecovery && <small>Atomic Recovery restored the monster to its starting Health.</small>}
          {typeof lastRecoveryRoll === "number" && <>
            <div className="combat-roll-list" aria-label="Recorded Hollywood recovery die">
              <DieCube value={lastRecoveryRoll} label={`Hollywood recovery roll: ${lastRecoveryRoll}`} />
            </div>
            <small>{lastRecoveryReleased ? "The monster recovered to 5+ Health and left Hollywood." : "The monster recovered Health but remains in Hollywood."}</small>
          </>}
        </div>
      )}
    </>
  );
}

import type { RefObject } from "react";
import { DieCube } from "./DieCube";

type Props = {
  actionHeadingRef: RefObject<HTMLHeadingElement | null>;
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
};

export function TurnPrompt({ actionHeadingRef, action, description, rulesHelp, unavailableReason, canAct, lastFightEventId, lastFightRolls, lastFightOutcomes, hollywoodResearchAwarded, lastRecoveryEventId, lastRecoveryRoll, lastRecoveryReleased }: Props) {
  return (
    <>
      <span className="label">CURRENT STEP</span>
      <h2 ref={actionHeadingRef} tabIndex={-1}>{action}</h2>
      <p>{description}</p>
      <aside className="decision-rules-help" aria-label="Rules help for current decision">
        <span className="label">DECISION HELP</span>
        <strong>{rulesHelp.title}</strong>
        <p>{rulesHelp.body}</p>
      </aside>
      {unavailableReason && !canAct && <p className="unavailable-reason" role="status">{unavailableReason}</p>}
      {lastFightEventId && lastFightRolls.length > 0 && (
        <div className="combat-result" key={lastFightEventId} aria-live="polite">
          <span className="label">LAST COMBAT ROLLS</span>
          <div className="combat-roll-list">
            {lastFightRolls.map((roll, index) => <DieCube key={`${lastFightEventId}-${index}`} value={roll} label={`Roll ${index + 1}: ${roll}`} />)}
          </div>
          {lastFightOutcomes.length > 0 && <ul className="combat-outcomes">{lastFightOutcomes.map((outcome, index) => <li key={`${lastFightEventId}-outcome-${index}`}>{outcome}</li>)}</ul>}
          {hollywoodResearchAwarded && <small>A rival player drew one Military Research card for sending the monster to Hollywood.</small>}
          <small>Recorded by the authoritative fight result; the animation is presentation only.</small>
        </div>
      )}
      {lastRecoveryEventId && typeof lastRecoveryRoll === "number" && (
        <div className="combat-result recovery-result" key={lastRecoveryEventId} aria-live="polite">
          <span className="label">LAST HOLLYWOOD RECOVERY</span>
          <div className="combat-roll-list" aria-label="Recorded Hollywood recovery die">
            <DieCube value={lastRecoveryRoll} label={`Hollywood recovery roll: ${lastRecoveryRoll}`} />
          </div>
          <small>{lastRecoveryReleased ? "The monster recovered to 5+ Health and left Hollywood." : "The monster recovered Health but remains in Hollywood."}</small>
        </div>
      )}
    </>
  );
}

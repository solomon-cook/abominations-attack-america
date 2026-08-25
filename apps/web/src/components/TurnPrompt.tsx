import type { RefObject } from "react";

type Props = {
  actionHeadingRef: RefObject<HTMLHeadingElement | null>;
  action: string;
  description: string;
  unavailableReason: string;
  canAct: boolean;
  lastFightEventId?: string;
  lastFightRolls: readonly number[];
  lastFightOutcomes: readonly string[];
};

export function TurnPrompt({ actionHeadingRef, action, description, unavailableReason, canAct, lastFightEventId, lastFightRolls, lastFightOutcomes }: Props) {
  return (
    <>
      <span className="label">CURRENT STEP</span>
      <h2 ref={actionHeadingRef} tabIndex={-1}>{action}</h2>
      <p>{description}</p>
      {unavailableReason && !canAct && <p className="unavailable-reason" role="status">{unavailableReason}</p>}
      {lastFightEventId && lastFightRolls.length > 0 && (
        <div className="combat-result" key={lastFightEventId} aria-live="polite">
          <span className="label">LAST COMBAT ROLLS</span>
          <div className="combat-roll-list">
            {lastFightRolls.map((roll, index) => <span className={`combat-die show-${roll}`} key={`${lastFightEventId}-${index}`} aria-label={`Roll ${index + 1}: ${roll}`}>
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
          </div>
          {lastFightOutcomes.length > 0 && <ul className="combat-outcomes">{lastFightOutcomes.map((outcome, index) => <li key={`${lastFightEventId}-outcome-${index}`}>{outcome}</li>)}</ul>}
          <small>Recorded by the authoritative fight result; the animation is presentation only.</small>
        </div>
      )}
    </>
  );
}

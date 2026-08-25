import type { RefObject } from "react";

type Props = {
  actionHeadingRef: RefObject<HTMLHeadingElement | null>;
  action: string;
  description: string;
  unavailableReason: string;
  canAct: boolean;
  lastFightEventId?: string;
  lastFightRolls: readonly number[];
};

export function TurnPrompt({ actionHeadingRef, action, description, unavailableReason, canAct, lastFightEventId, lastFightRolls }: Props) {
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
            {lastFightRolls.map((roll, index) => <span key={`${lastFightEventId}-${index}`} aria-label={`Roll ${index + 1}: ${roll}`}>{roll}</span>)}
          </div>
          <small>Recorded by the authoritative fight result; the animation is presentation only.</small>
        </div>
      )}
    </>
  );
}

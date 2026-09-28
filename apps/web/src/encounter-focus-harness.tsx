import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { ActionDock } from "./components/ActionDock";
import { EncounterOverlay } from "./components/EncounterOverlay";
import { useEncounterOverlayState } from "./encounter-overlay-state";
import "./styles.css";
import "./encounter-command.css";
import "./dice.css";

function Harness() {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  const pendingFixture = scenario === "pending" || scenario === "choice-failure";
  const choiceFailureFixture = scenario === "choice-failure";
  const bodyFallbackFixture = scenario === "body-fallback";
  const ownershipFixture = scenario === "ownership";
  const [revealed, setRevealed] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState("");
  const [participantRole, setParticipantRole] = useState<string | undefined>("player");
  const [participantPlayerIndex, setParticipantPlayerIndex] = useState(0);
  const actionHeadingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const commandErrorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const failedChoiceOnceRef = useRef(false);
  const activeElementAtOpenRef = useRef<string | null>(null);
  const encounterOverlay = useEncounterOverlayState({
    online: true,
    participantRole,
    participantPlayerIndex,
    decisionPlayer: 0,
  });
  const { open, requestedOpen, ownerPlayerIndex, openForPlayer, close } = encounterOverlay;

  useEffect(() => {
    if (pendingAction || !error) return;
    const opener = commandErrorOpenerRef.current;
    commandErrorOpenerRef.current = null;
    if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
  }, [error, pendingAction]);
  const openEncounter = (opener: HTMLButtonElement) => {
    openerRef.current = bodyFallbackFixture ? null : opener;
    if (bodyFallbackFixture) opener.blur();
    activeElementAtOpenRef.current = document.activeElement instanceof HTMLElement ? document.activeElement.tagName : null;
    openForPlayer(0);
  };

  useEffect(() => {
    const fixture = window as Window & {
      __encounterOwnershipFixture?: {
        setRole: (role: string | undefined) => void;
        setSeat: (playerIndex: number) => void;
      };
    };
    fixture.__encounterOwnershipFixture = {
      setRole: setParticipantRole,
      setSeat: setParticipantPlayerIndex,
    };
    return () => { delete fixture.__encounterOwnershipFixture; };
  }, []);

  return <main className="game-screen encounter-focus-harness">
    <h1>Encounter focus acceptance fixture</h1>
    <h2 id="action-heading" ref={actionHeadingRef} tabIndex={-1}>Encounter phase actions</h2>
    {!revealed && <ActionDock
      label="Resolve encounter"
      canAct
      command={{ type: "resolve-encounter" }}
      onAction={(_command, opener) => { if (opener) openEncounter(opener); }}
    />}
    {ownershipFixture && <output id="encounter-ownership-state">{JSON.stringify({ open, requestedOpen, ownerPlayerIndex, participantRole, participantPlayerIndex })}</output>}
    <output id="encounter-focus-state" aria-label="Fixture state">{JSON.stringify({ open, requestedOpen, ownerPlayerIndex, openerLabel: openerRef.current?.getAttribute("aria-label") ?? null, activeElementAtOpen: activeElementAtOpenRef.current, revealed, pendingChoice, pendingAction, choice, error })}</output>
    <EncounterOverlay
      error={error}
      open={open}
      canAct={!pendingAction}
      autoPlay={pendingFixture}
      pendingChoice={pendingChoice}
      monsterName="Zorb"
      locationName="Fixture location"
      eventId={revealed ? "fixture-encounter-resolved" : undefined}
      baselineEventId="fixture-encounter-prompt"
      effects={[]}
      rolls={[]}
      choices={pendingChoice ? ["health", "infamy"] : []}
      mutationDraws={[]}
      returnFocusTo={openerRef.current}
      returnFocusFallbackTo={actionHeadingRef.current}
      onReveal={() => {
        setRevealed(true);
        setPendingChoice(pendingFixture);
      }}
      onChoice={(selected, commandOpener) => {
        commandErrorOpenerRef.current = null;
        setError("");
        setPendingAction(true);
        window.setTimeout(() => {
          if (choiceFailureFixture && !failedChoiceOnceRef.current) {
            failedChoiceOnceRef.current = true;
            commandErrorOpenerRef.current = commandOpener;
            setError("Harness-injected overlay command failure.");
            setPendingAction(false);
            return;
          }
          setChoice(selected);
          setPendingChoice(false);
          setPendingAction(false);
        }, 80);
      }}
      onClose={close}
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);

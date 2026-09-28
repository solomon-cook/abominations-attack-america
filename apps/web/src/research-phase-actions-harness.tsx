import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { applyCommand, createGame, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { CardReveal, ResolutionStage } from "./components/ResolutionStage";
import { PhaseActions } from "./components/PhaseActions";
import "./encounter-command.css";
import "./physical-sheets.css";

function createDeploymentFixture() {
  const game = createGame(2, 0, "research-phase-actions-browser-harness");
  game.phase = "deploy";
  game.pendingDecision = { type: "deployment", playerIndex: game.currentPlayer };
  game.units.filter((unit) => unit.branch === "Army").forEach((unit) => { unit.location = "record-tile"; });
  return game;
}

function Harness() {
  const [game, setGame] = useState<GameState>(createDeploymentFixture);
  const [researchCardId, setResearchCardId] = useState<string | null>(null);
  const [capturedTrigger, setCapturedTrigger] = useState("");
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const returnFocusFallbackTo = useRef<HTMLElement | null>(null);
  const runCommand = (command: GameCommand) => {
    if (command.type !== "draw-research") return;
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusFallbackTo.current = heading.current;
    setCapturedTrigger(returnFocusTo.current?.getAttribute("aria-label") ?? returnFocusTo.current?.textContent?.trim() ?? "");
    const result = applyCommand(game, command);
    setGame(result.state);
    if (typeof result.eventPayload.cardId === "string") setResearchCardId(result.eventPayload.cardId);
  };
  return <main>
    <header><h1 ref={heading} tabIndex={-1}>Direct Research action · {game.phase}</h1></header>
    <section aria-label="Direct phase actions">
      <PhaseActions
        activeGame={game}
        onOpenMilitarySheet={() => undefined}
        canAct
        runCommand={runCommand}
        getLocationName={(key) => key}
        pendingAttackPrompt=""
        canSpendInfamyOnPendingBattle={false}
        retreatChoices={retreatChoices}
        setRetreatChoices={setRetreatChoices}
      />
    </section>
    <output data-testid="captured-research-trigger">{capturedTrigger}</output>
    {researchCardId && <ResolutionStage
      title="Research"
      eyebrow="MILITARY / RESEARCH DIVISION"
      variant="research"
      returnFocusTo={returnFocusTo.current}
      returnFocusFallbackTo={returnFocusFallbackTo.current}
      onClose={() => setResearchCardId(null)}
    ><CardReveal key={researchCardId} cardId={researchCardId} kind="research" /></ResolutionStage>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);

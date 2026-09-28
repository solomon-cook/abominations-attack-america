import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { FightResolutionPanel } from "./components/FightResolutionPanel";

const battleId = "fight-infamy-harness";

function createFixture(infamy: number) {
  const game = createGame(2, 14, "fight-infamy-browser-harness");
  game.currentPlayer = 0;
  game.monsters[0]!.health = 40;
  game.monsters[0]!.infamy = infamy;
  game.units[0]!.location = game.monsters[0]!.location;
  game.units[2]!.location = game.monsters[0]!.location;
  game.units[0]!.defense = 99;
  game.units[2]!.defense = 99;
  game.phase = "fight";
  game.pendingBattles = [{
    id: battleId,
    monsterId: game.monsters[0]!.id,
    location: game.monsters[0]!.location as HexKey,
    militaryUnitIds: [game.units[0]!.id, game.units[2]!.id],
  }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  return game;
}

function Harness() {
  const query = new URLSearchParams(window.location.search);
  const fixtureInfamy = Number(query.get("infamy") ?? 1) === 0 ? 0 : 1;
  const [game, setGame] = useState<GameState>(() => createFixture(fixtureInfamy));
  const canAct = query.get("role") !== "spectator";
  const event = game.eventLog.at(-1);
  const onChooseTarget = (unitId: string, selectedBattleId: string, spendInfamy?: number) => {
    const command: GameCommand = { type: "resolve-fight", battleId: selectedBattleId, targetUnitId: unitId, spendInfamy };
    setGame((current) => applyCommand(current, command).state);
  };
  const snapshot = {
    monsterInfamy: game.monsters[0]?.infamy,
    phase: game.phase,
    pendingDecision: game.pendingDecision,
    pendingCombat: game.pendingCombat,
    event: event ? { action: event.action, detail: event.detail } : null,
  };
  return <main>
    <h1>Fight resolution fixture</h1>
    <output id="fight-state" aria-label="Fight state">{JSON.stringify(snapshot)}</output>
    <FightResolutionPanel
      open
      returnFocusTo={null}
      onClose={() => undefined}
      controls={null}
      game={game}
      canAct={canAct}
      pendingBattle={game.pendingBattles[0]}
      pendingAttackTarget={game.pendingDecision?.type === "attack-target" ? game.pendingDecision : undefined}
      event={event}
      onChooseTarget={onChooseTarget}
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);

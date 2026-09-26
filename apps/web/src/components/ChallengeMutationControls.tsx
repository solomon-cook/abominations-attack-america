import type { GameCommand, GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canUseMutation: boolean;
  playerIndex?: number;
  runCommand: (command: GameCommand) => void | Promise<void>;
  disabled?: boolean;
};

export function ChallengeMutationControls({ game, canUseMutation, playerIndex, runCommand, disabled = false }: Props) {
  const challenge = game.challenge;
  const resolving = game.pendingDecision?.type === "challenge-resolution" || game.pendingDecision?.type === "challenge-giant-resolution";
  if (game.phase !== "challenge" || !challenge?.active || !challenge.turn || !resolving || (!challenge.opponentMonsterId && !challenge.giantUnitId)) return null;
  const owners = [...new Set([challenge.challengerMonsterId, challenge.opponentMonsterId].filter((id): id is string => Boolean(id)))];
  const actions = owners.flatMap((monsterId) => {
    const ownerIndex = game.monsters.findIndex((monster) => monster.id === monsterId);
    if (ownerIndex < 0 || (playerIndex !== undefined && playerIndex !== ownerIndex)) return [];
    const monsterName = game.monsters[ownerIndex]!.name;
    return (game.players[ownerIndex]?.mutationCardIds ?? [])
      .filter((cardId) => cardId === "Berserk" || cardId === "Son of a Monster")
      .map((cardId) => ({ cardId, ownerIndex, monsterName }));
  });
  if (!actions.length) return null;
  return <div className="battle-choice" aria-label="Challenge Mutation cards">
    <span>Use during this Challenge:</span>
    {actions.map(({ cardId, ownerIndex, monsterName }) => <button key={`${ownerIndex}:${cardId}`} disabled={!canUseMutation || disabled} onClick={() => void runCommand({ type: "use-mutation", cardId })}>{monsterName} · {cardId} · {cardId === "Berserk" ? "+5 attacks" : "+2 attacks and d6 Health"}</button>)}
  </div>;
}

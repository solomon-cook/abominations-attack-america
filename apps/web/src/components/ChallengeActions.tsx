import type { GameState } from "@abominations/game-engine";

type Props = {
  onOpen: () => void;
  activeGame: GameState;
};

export function ChallengeActions({ activeGame, onOpen }: Props) {
  if (activeGame.phase !== "challenge") return null;
  return <button className="cinema-primary" onClick={onOpen}>Enter Monster Challenge →</button>;
}

import { legalLaserFenceTargets, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";

type Props = {
  game: GameState;
  cardOwnerIndex: number;
  canUse: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
  getLocationName: (key: HexKey) => string;
};

/** Render each live post-move reaction for the player who holds Laser Fence. */
export function LaserFenceControls({ game, cardOwnerIndex, canUse, runCommand, getLocationName }: Props) {
  if (cardOwnerIndex < 0 || !game.players[cardOwnerIndex]?.researchCardIds.includes("Laser Fence")) return null;
  const targets = legalLaserFenceTargets(game);
  if (!targets.length) return null;
  return <section className="laser-fence-controls" aria-label="Laser Fence reactions">
    <strong>Laser Fence · after movement, before battle</strong>
    {targets.map((target) => {
      const monster = game.monsters.find((candidate) => candidate.id === target.targetMonsterId);
      return <div className="laser-fence-target" key={target.targetMonsterId}>
        <span>{monster?.name ?? target.targetMonsterId} at {getLocationName(target.location)}</span>
        <button type="button" disabled={!canUse || target.infamy < 2} onClick={() => void runCommand({ type: "use-research", cardId: "Laser Fence", targetMonsterId: target.targetMonsterId, choice: "infamy" })}>Pay 2 Infamy</button>
        {target.retreatDestinations.map((destination) => <button type="button" key={destination} disabled={!canUse} onClick={() => void runCommand({ type: "use-research", cardId: "Laser Fence", targetMonsterId: target.targetMonsterId, choice: "retreat", destination })}>Retreat to {getLocationName(destination)}</button>)}
      </div>;
    })}
  </section>;
}

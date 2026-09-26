import { useEffect, useMemo, useState } from "react";
import { isHexKey, legalChopperLiftDestinations, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canChoose: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
  getLocationName: (key: HexKey) => string;
};

/** The die is committed by the backend before the player chooses their move. */
export function ChopperLiftChoiceControls({ game, canChoose, runCommand, getLocationName }: Props) {
  const pending = game.pendingChopperLift;
  const [monsterId, setMonsterId] = useState("");
  const [destination, setDestination] = useState<HexKey | "">("");
  const monsters = game.monsters.filter((monster) => monster.health > 0 && isHexKey(monster.location));
  const selectedMonsterId = monsters.some((monster) => monster.id === monsterId) ? monsterId : monsters[0]?.id ?? "";
  const destinations = useMemo(() => pending && selectedMonsterId
    ? legalChopperLiftDestinations(game, selectedMonsterId, pending.roll)
    : [], [game, pending, selectedMonsterId]);
  const selectedDestination = destinations.includes(destination as HexKey) ? destination as HexKey : destinations[0];

  useEffect(() => {
    if (destination && !destinations.includes(destination)) setDestination("");
  }, [destination, destinations]);

  if (!pending) return null;
  if (!canChoose) return <p className="chopper-lift-pending" role="status">Player {pending.playerIndex + 1} rolled {pending.roll} for Chopper Lift and is choosing a monster and destination.</p>;
  return <section className="chopper-lift-choice" aria-label="Chopper Lift movement choice">
    <strong>Chopper Lift rolled {pending.roll}. Choose a monster, then a landing space.</strong>
    <label>Monster
      <select aria-label="Chopper Lift monster" value={selectedMonsterId} onChange={(event) => { setMonsterId(event.target.value); setDestination(""); }}>
        {monsters.map((monster) => <option key={monster.id} value={monster.id}>{monster.name}</option>)}
      </select>
    </label>
    <label>Destination · up to {pending.roll} spaces
      <select aria-label="Chopper Lift destination" value={selectedDestination ?? ""} onChange={(event) => setDestination(event.target.value as HexKey)} disabled={!destinations.length}>
        {destinations.map((key) => <option key={key} value={key}>{key === game.monsters.find((monster) => monster.id === selectedMonsterId)?.location ? `Stay at ${getLocationName(key)}` : getLocationName(key)}</option>)}
      </select>
    </label>
    <button type="button" disabled={!selectedMonsterId || !selectedDestination} onClick={() => selectedDestination && void runCommand({ type: "resolve-chopper-lift", targetMonsterId: selectedMonsterId, destination: selectedDestination })}>Move monster · lose 1 Infamy</button>
  </section>;
}

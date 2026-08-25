import { DieCube } from "./DieCube";

type ChallengeAttack = Readonly<{
  attackerId: string;
  targetId: string;
  roll: number;
  hit: boolean;
  smash: boolean;
  damage: number;
  targetHealthBefore?: number;
  targetHealthAfter?: number;
}>;

type Props = {
  eventId?: string;
  winnerName?: string;
  defeatedName?: string;
  winnerHealth?: number;
  loserWeighIn?: number;
  rolls: readonly number[];
  attacks: readonly ChallengeAttack[];
  victoryType?: string;
};

export function ChallengeDuelPanel({ eventId, winnerName, defeatedName, winnerHealth, loserWeighIn, rolls, attacks, victoryType }: Props) {
  if (!eventId) return null;
  return (
    <section className="challenge-duel-panel" key={eventId} aria-live="polite" aria-label="Recorded Monster Challenge duel">
      <div className="challenge-duel-heading">
        <span className="label">MONSTER CHALLENGE</span>
        <strong>{victoryType === "monster-challenge" ? "King of the Giant Monsters" : "Authoritative duel result"}</strong>
      </div>
      <div className="challenge-duel-sides">
        <div className="challenge-duel-side challenge-duel-winner">
          <span className="label">SURVIVOR</span>
          <strong>{winnerName ?? "Winning monster"}</strong>
          <span>{typeof winnerHealth === "number" ? `${winnerHealth} Health after weigh-in recovery` : "Health recorded by the engine"}</span>
        </div>
        <div className="challenge-duel-rolls" aria-label="Authoritative Monster Challenge dice rolls">
          <span className="label">DICE</span>
          <div className="combat-roll-list">{rolls.map((roll, index) => <DieCube key={`${eventId}-roll-${index}`} value={roll} label={`Challenge roll ${index + 1}: ${roll}`} />)}</div>
        </div>
        <div className="challenge-duel-side challenge-duel-defeated">
          <span className="label">DEFEATED</span>
          <strong>{defeatedName ?? "Defeated monster"}</strong>
          <span>{typeof loserWeighIn === "number" ? `${loserWeighIn} weigh-in Health` : "Weigh-in Health recorded"}</span>
        </div>
      </div>
      {attacks.length > 0 && <ol className="challenge-duel-attacks" aria-label="Authoritative duel Health changes">
        {attacks.map((attack, index) => <li key={`${eventId}-attack-${index}`}>
          <span>Round {index + 1}: {attack.attackerId} → {attack.targetId}</span>
          <strong>{attack.hit ? `-${attack.damage} Health${attack.smash ? " · smash" : ""}` : "Miss"}</strong>
          {typeof attack.targetHealthBefore === "number" && typeof attack.targetHealthAfter === "number" && <small>{attack.targetHealthBefore} → {attack.targetHealthAfter} Health</small>}
        </li>)}
      </ol>}
      <small className="challenge-duel-note">Dice, damage, and Health transitions are replayed from the authoritative Challenge result; presentation cannot alter the duel.</small>
    </section>
  );
}

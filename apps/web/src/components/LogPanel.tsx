import type { GameState } from "@abominations/game-engine";
import { usePlayerNames } from "./player-name-context";

type Props = {
  eventLog: GameState["eventLog"];
  log: GameState["log"];
};

export function LogPanel({ eventLog, log }: Props) {
  const playerNames = usePlayerNames();
  const personalize = (text: string) => text.replace(/\bPlayer (\d+)\b/g, (label, seat: string) => playerNames[Number(seat) - 1] ?? label);
  return (
    <div className="card log">
      <span className="label">TURN LOG</span>
      {eventLog.length
        ? eventLog.map((entry) => (
            <details key={entry.id}>
              <summary>
                {entry.actorId ? `${entry.actorId} · ` : ""}
                {entry.action} · {entry.outcome}
              </summary>
              <pre>{personalize(JSON.stringify(entry.detail, null, 2))}</pre>
            </details>
          ))
        : log.map((entry, index) => <p key={index}>{personalize(entry)}</p>)}
    </div>
  );
}

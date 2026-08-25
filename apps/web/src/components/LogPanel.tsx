import type { GameState } from "@abominations/game-engine";

type Props = {
  eventLog: GameState["eventLog"];
  log: GameState["log"];
};

export function LogPanel({ eventLog, log }: Props) {
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
              <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
            </details>
          ))
        : log.map((entry, index) => <p key={index}>{entry}</p>)}
    </div>
  );
}

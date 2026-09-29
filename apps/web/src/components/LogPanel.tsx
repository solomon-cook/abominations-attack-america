import type { GameState } from "@abominations/game-engine";

type Props = {
  eventLog: GameState["eventLog"];
  log: GameState["log"];
  participants: readonly Readonly<{ id: string; displayName: string }>[];
};

export function LogPanel({ eventLog, log, participants }: Props) {
  const participantNames = new Map(participants.map(({ id, displayName }) => [id, displayName.trim()]));
  return (
    <div className="card log">
      <span className="label">TURN LOG</span>
      {eventLog.length
        ? eventLog.map((entry) => (
            <details key={entry.id}>
              <summary>
                {entry.actorId ? `${participantNames.get(entry.actorId) || "Player"} · ` : ""}
                {entry.action} · {entry.outcome}
              </summary>
              <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
            </details>
          ))
        : log.map((entry, index) => <p key={index}>{entry}</p>)}
    </div>
  );
}

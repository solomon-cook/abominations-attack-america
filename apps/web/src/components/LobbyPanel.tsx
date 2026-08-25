import type { RoomView } from "@abominations/shared";

export type LobbyPanelProps = {
  online: boolean;
  room: RoomView | null;
  participant?: RoomView["participants"][number];
  connectionState: "online" | "reconnecting" | "stale" | "offline";
  displayName: string;
  playerCount: 2 | 3 | 4;
  roomCode: string;
  setupComplete: boolean;
  error: string;
  onDisplayNameChange: (value: string) => void;
  onPlayerCountChange: (value: 2 | 3 | 4) => void;
  onRoomCodeChange: (value: string) => void;
  onStartSession: (kind: "create" | "join" | "spectate") => void;
  onToggleReady: () => void;
  onLeaveRoom: () => void;
};

export function LobbyPanel({
  online,
  room,
  participant,
  connectionState,
  displayName,
  playerCount,
  roomCode,
  setupComplete,
  error,
  onDisplayNameChange,
  onPlayerCountChange,
  onRoomCodeChange,
  onStartSession,
  onToggleReady,
  onLeaveRoom,
}: LobbyPanelProps) {
  return (
    <section className="lobby" aria-label="Online room lobby">
      <div>
        <span className="label">ONLINE ROOM</span>
        <p>
          {online ? (
            <>
              Room <strong>{room?.code}</strong> ·{" "}
              <span className={`connection ${connectionState}`}>{connectionState}</span> ·{" "}
              {participant?.role === "spectator" ? "spectating" : `Player ${(participant?.playerIndex ?? 0) + 1}`}
            </>
          ) : "Play with friends or watch without an account."}
        </p>
      </div>
      {!online && (
        <div className="lobby-actions">
          <input value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Display name" />
          <select aria-label="Player count" value={playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}>
            <option value="2">2 players</option>
            <option value="3">3 players</option>
            <option value="4">4 players</option>
          </select>
          <input value={roomCode} onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())} placeholder="Room code" maxLength={6} />
          <button onClick={() => onStartSession("create")}>Create</button>
          <button onClick={() => onStartSession("join")}>Join</button>
          <button className="subtle" onClick={() => onStartSession("spectate")}>Spectate</button>
        </div>
      )}
      {online && participant?.role === "player" && (
        <div className="lobby-actions">
          <button className="ready-button" disabled={!setupComplete} onClick={onToggleReady}>
            {participant.ready ? "Unready" : "Ready"}
          </button>
          <button className="subtle" onClick={onLeaveRoom}>Leave room</button>
        </div>
      )}
      {online && participant?.role === "spectator" && <button className="subtle" onClick={onLeaveRoom}>Leave room</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

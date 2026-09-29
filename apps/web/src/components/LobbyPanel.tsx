import { useRef, useState } from "react";
import type { PublicRoomSummary, RoomView } from "@abominations/shared";
import { InviteLinkControl } from "./InviteLinkControl";

export type LobbyPanelProps = {
  online: boolean;
  room: RoomView | null;
  participant?: RoomView["participants"][number];
  connectionState: "online" | "reconnecting" | "stale" | "offline";
  displayName: string;
  playerCount: 2 | 3 | 4;
  roomPrivacy: "private" | "public";
  roomCode: string;
  publicRooms: PublicRoomSummary[];
  setupComplete: boolean;
  error: string;
  onDisplayNameChange: (value: string) => void;
  onPlayerCountChange: (value: 2 | 3 | 4) => void;
  onRoomPrivacyChange: (value: "private" | "public") => void;
  onRoomCodeChange: (value: string) => void;
  onRefreshPublicRooms: () => void;
  onStartSession: (kind: "create" | "join" | "spectate") => Promise<void>;
  onToggleReady: () => void;
  onRecoverConnection: () => void;
  onLeaveRoom: () => void;
};

export function LobbyPanel({
  online,
  room,
  participant,
  connectionState,
  displayName,
  playerCount,
  roomPrivacy,
  roomCode,
  publicRooms,
  setupComplete,
  error,
  onDisplayNameChange,
  onPlayerCountChange,
  onRoomPrivacyChange,
  onRoomCodeChange,
  onRefreshPublicRooms,
  onStartSession,
  onToggleReady,
  onRecoverConnection,
  onLeaveRoom,
}: LobbyPanelProps) {
  const [pendingSessionAction, setPendingSessionAction] = useState<"create" | "join" | "spectate" | null>(null);
  const pendingSessionActionRef = useRef<"create" | "join" | "spectate" | null>(null);
  const startSession = async (kind: "create" | "join" | "spectate") => {
    if (pendingSessionActionRef.current) return;
    pendingSessionActionRef.current = kind;
    setPendingSessionAction(kind);
    try {
      await onStartSession(kind);
    } finally {
      pendingSessionActionRef.current = null;
      setPendingSessionAction(null);
    }
  };
  const pendingMessage = pendingSessionAction
    ? pendingSessionAction === "spectate"
      ? "Joining room as spectator…"
      : `${pendingSessionAction === "create" ? "Creating" : "Joining"} room…`
    : "";
  return (
    <section className="lobby" aria-label="Online room lobby">
      <div>
        <span className="label">ONLINE ROOM</span>
        <p>
          {online ? (
            <>
              Room <strong>{room?.code}</strong> · {room?.privacy ?? "private"} ·{" "}
              <span className={`connection ${connectionState}`}>{connectionState}</span> ·{" "}
              {participant?.role === "spectator" ? "spectating" : `Player ${(participant?.playerIndex ?? 0) + 1}`}
            </>
          ) : "Play with friends or watch without an account."}
        </p>
      </div>
      {!online && (
        <div className="lobby-actions" aria-busy={Boolean(pendingSessionAction)}>
          <input aria-label="Display name" disabled={Boolean(pendingSessionAction)} value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Display name" />
          <select aria-label="Player count" disabled={Boolean(pendingSessionAction)} value={playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}>
            <option value="2">2 players</option>
            <option value="3">3 players</option>
            <option value="4">4 players</option>
          </select>
          <select aria-label="Room privacy" disabled={Boolean(pendingSessionAction)} value={roomPrivacy} onChange={(event) => onRoomPrivacyChange(event.target.value as "private" | "public")}>
            <option value="private">Private room</option>
            <option value="public">Public room</option>
          </select>
          <input aria-label="Room code" disabled={Boolean(pendingSessionAction)} value={roomCode} onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())} placeholder="Room code" maxLength={6} />
          <button type="button" disabled={Boolean(pendingSessionAction)} onClick={() => void startSession("create")}>Create</button>
          <button type="button" disabled={Boolean(pendingSessionAction)} onClick={() => void startSession("join")}>Join</button>
          <button type="button" className="subtle" disabled={Boolean(pendingSessionAction)} onClick={() => void startSession("spectate")}>Spectate</button>
          <button type="button" className="subtle" disabled={Boolean(pendingSessionAction)} onClick={onRefreshPublicRooms}>Find public rooms</button>
        </div>
      )}
      {pendingMessage && <p className="lobby-pending" role="status">{pendingMessage}</p>}
      {!online && publicRooms.length > 0 && (
        <div className="public-room-list" aria-label="Public rooms">
          <span className="label">OPEN ROOMS</span>
          {publicRooms.map((candidate) => (
            <button key={candidate.code} type="button" className="public-room" disabled={Boolean(pendingSessionAction)} onClick={() => onRoomCodeChange(candidate.code)}>
              <strong>{candidate.code}</strong>
              <span>{candidate.status} · {candidate.playerCount}/{candidate.maxPlayers} players · {candidate.spectatorCount} spectators</span>
            </button>
          ))}
        </div>
      )}
      {online && participant?.role === "player" && (
        <div className="lobby-actions">
          <button type="button" className="ready-button" disabled={!setupComplete} onClick={onToggleReady}>
            {participant.ready ? "Unready" : "Ready"}
          </button>
          <InviteLinkControl roomCode={room?.code ?? ""} />
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
        </div>
      )}
      {online && participant?.role === "spectator" && (
        <div className="lobby-actions">
          <InviteLinkControl roomCode={room?.code ?? ""} />
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
        </div>
      )}
      {online && connectionState === "stale" && (
        <div className="lobby-actions connection-recovery">
          <p role="status">This tab could not resume its room connection. Resetting replaces this seat’s room token; reload other tabs that share it.</p>
          <button type="button" onClick={onRecoverConnection}>Reset this connection</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

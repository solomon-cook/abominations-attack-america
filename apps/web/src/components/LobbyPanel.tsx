import { useState } from "react";
import type { RoomView } from "@abominations/shared";

export type LobbyPanelProps = {
  online: boolean;
  room: RoomView | null;
  participant?: RoomView["participants"][number];
  connectionState: "online" | "reconnecting" | "stale" | "offline";
  displayName: string;
  playerCount: 2 | 3 | 4;
  roomPrivacy: "private" | "public";
  roomCode: string;
  setupComplete: boolean;
  error: string;
  onDisplayNameChange: (value: string) => void;
  onPlayerCountChange: (value: 2 | 3 | 4) => void;
  onRoomPrivacyChange: (value: "private" | "public") => void;
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
  roomPrivacy,
  roomCode,
  setupComplete,
  error,
  onDisplayNameChange,
  onPlayerCountChange,
  onRoomPrivacyChange,
  onRoomCodeChange,
  onStartSession,
  onToggleReady,
  onLeaveRoom,
}: LobbyPanelProps) {
  const [inviteStatus, setInviteStatus] = useState("");
  const copyInviteLink = async () => {
    if (!room?.code) return;
    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = `?room=${encodeURIComponent(room.code)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl.toString());
      setInviteStatus("Invite link copied");
    } catch {
      setInviteStatus(inviteUrl.toString());
    }
  };
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
        <div className="lobby-actions">
          <input aria-label="Display name" value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Display name" />
          <select aria-label="Player count" value={playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}>
            <option value="2">2 players</option>
            <option value="3">3 players</option>
            <option value="4">4 players</option>
          </select>
          <select aria-label="Room privacy" value={roomPrivacy} onChange={(event) => onRoomPrivacyChange(event.target.value as "private" | "public")}>
            <option value="private">Private room</option>
            <option value="public">Public room</option>
          </select>
          <input aria-label="Room code" value={roomCode} onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())} placeholder="Room code" maxLength={6} />
          <button type="button" onClick={() => onStartSession("create")}>Create</button>
          <button type="button" onClick={() => onStartSession("join")}>Join</button>
          <button type="button" className="subtle" onClick={() => onStartSession("spectate")}>Spectate</button>
        </div>
      )}
      {online && participant?.role === "player" && (
        <div className="lobby-actions">
          <button type="button" className="ready-button" disabled={!setupComplete} onClick={onToggleReady}>
            {participant.ready ? "Unready" : "Ready"}
          </button>
          <button type="button" className="subtle" onClick={() => void copyInviteLink}>Copy invite link</button>
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
          {inviteStatus && <span className="invite-status" role="status">{inviteStatus}</span>}
        </div>
      )}
      {online && participant?.role === "spectator" && (
        <div className="lobby-actions">
          <button type="button" className="subtle" onClick={() => void copyInviteLink}>Copy invite link</button>
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
          {inviteStatus && <span className="invite-status" role="status">{inviteStatus}</span>}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

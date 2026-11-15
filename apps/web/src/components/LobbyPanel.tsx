import { useState } from "react";
import type { PublicRoomSummary, RoomView } from "@abominations/shared";
import { RoomQrCode } from "./RoomQrCode";

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
  pendingAction: boolean;
  error: string;
  onDisplayNameChange: (value: string) => void;
  onPlayerCountChange: (value: 2 | 3 | 4) => void;
  onRoomPrivacyChange: (value: "private" | "public") => void;
  onRoomCodeChange: (value: string) => void;
  onRefreshPublicRooms: () => void;
  onStartSession: (kind: "create" | "join" | "spectate") => void;
  onToggleReady: () => void;
  onAddBot: () => void;
  onStartMatch: () => void;
  onCreateViewerLink?: () => Promise<string>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onBackToMenu?: () => void;
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
  pendingAction,
  error,
  onDisplayNameChange,
  onPlayerCountChange,
  onRoomPrivacyChange,
  onRoomCodeChange,
  onRefreshPublicRooms,
  onStartSession,
  onToggleReady,
  onAddBot,
  onStartMatch,
  onCreateViewerLink,
  onLeaveRoom,
  onDeleteRoom,
  onBackToMenu,
}: LobbyPanelProps) {
  const [entryMode, setEntryMode] = useState<"choose" | "create" | "join">(() => roomCode ? "join" : "choose");
  const [inviteStatus, setInviteStatus] = useState("");
  void onAddBot;
  const roomQrUrl = room?.code ? `${window.location.origin}/?room=${encodeURIComponent(room.code)}&qr=1` : "";
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
  const copyViewerLink = async () => {
    if (!room?.code || !onCreateViewerLink) return;
    try {
      const viewerToken = await onCreateViewerLink();
      const viewerUrl = new URL(window.location.href);
      viewerUrl.search = `?room=${encodeURIComponent(room.code)}`;
      viewerUrl.hash = `watch=${encodeURIComponent(viewerToken)}`;
      await navigator.clipboard.writeText(viewerUrl.toString());
      setInviteStatus("TV viewing link copied · valid for 24 hours");
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : "Could not create the TV viewing link.");
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
          ) : "Create a room or join one with a code."}
        </p>
      </div>
      {!online && (
        <div className="lobby-entry">
          {entryMode === "choose" ? <div className="lobby-entry-options" aria-label="Multiplayer options">
            <button type="button" disabled={pendingAction} onClick={() => onStartSession("create")}>Create room <span aria-hidden="true">→</span></button>
            <button type="button" disabled={pendingAction} onClick={() => setEntryMode("join")}>Join room <span aria-hidden="true">→</span></button>
          </div> : <div className="lobby-entry-form">
            <button type="button" className="lobby-entry-back" onClick={() => setEntryMode("choose")}>← Back</button>
            <label>Display name<input aria-label="Display name" value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Your name" /></label>
            <>
              <label>Room code<input aria-label="Room code" value={roomCode} onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())} placeholder="Enter room code" maxLength={6} /></label>
              <button type="button" disabled={pendingAction || roomCode.trim().length < 4} onClick={() => onStartSession("join")}>Join room</button>
              <button type="button" className="subtle" disabled={pendingAction || roomCode.trim().length < 4} onClick={() => onStartSession("spectate")}>Join as spectator</button>
              <button type="button" className="subtle" disabled={pendingAction} onClick={onRefreshPublicRooms}>Find public rooms</button>
            </>
          </div>}
        </div>
      )}
      {!online && publicRooms.length > 0 && (
        <div className="public-room-list" aria-label="Public rooms">
          <span className="label">OPEN ROOMS</span>
          {publicRooms.map((candidate) => (
            <button key={candidate.code} type="button" className="public-room" onClick={() => onRoomCodeChange(candidate.code)}>
              <strong>{candidate.code}</strong>
              <span>{candidate.status} · {candidate.playerCount}/{candidate.maxPlayers} players · {candidate.spectatorCount} spectators</span>
            </button>
          ))}
        </div>
      )}
      {online && room && !room.matchStarted && participant?.role === "player" && (
        <div className="lobby-waiting-room">
          <div className="lobby-room-management"><button type="button" className="subtle" onClick={onBackToMenu ?? onLeaveRoom}>← Back to multiplayer</button>{participant.playerIndex === 0 && <button type="button" className="subtle lobby-delete-room" onClick={onDeleteRoom}>Delete room</button>}</div>
          {participant.playerIndex === 0 && <label className="lobby-room-privacy">Room visibility<select aria-label="Room visibility" value={room.privacy} disabled={pendingAction} onChange={(event) => onRoomPrivacyChange(event.target.value as "private" | "public")}><option value="private">Private</option><option value="public">Public</option></select></label>}
          <h2>Waiting room</h2>
          <p>Share the room code. The host can start at any time; bots fill all open seats.</p>
          <div className="lobby-player-seats" aria-label="Players in this room">
            {Array.from({ length: room.maxPlayers }, (_, index) => {
              const seat = room.participants.find((candidate) => candidate.role === "player" && candidate.playerIndex === index);
              return <div key={index} className="lobby-player-seat"><span>Player {index + 1}</span><strong>{seat?.displayName ?? "Waiting to join"}</strong><small>{seat ? seat.botControlled ? "Bot" : seat.connected ? "Connected" : "Reconnecting" : "Open seat"}</small></div>;
            })}
          </div>
          {roomQrUrl && <div className="lobby-room-qr"><RoomQrCode value={roomQrUrl} size={144} label="QR code to join this room or spectate if full"/><span>Scan to join · spectators welcome when full</span></div>}
          <button type="button" className="ready-button" disabled={pendingAction || participant.playerIndex !== 0} onClick={onStartMatch}>{pendingAction ? "Starting…" : "Start match"}</button>
        </div>
      )}
      {online && room?.matchStarted && participant?.role === "player" && (
        <div className="lobby-actions">
          <button type="button" className="ready-button" disabled={!setupComplete} onClick={onToggleReady}>
            {participant.ready ? "Unready" : "Ready"}
          </button>
          <button type="button" className="subtle" onClick={() => void copyInviteLink()}>Copy invite link</button>
          {onCreateViewerLink && <button type="button" className="subtle" onClick={() => void copyViewerLink()}>Copy TV viewing link</button>}
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
          {inviteStatus && <span className="invite-status" role="status">{inviteStatus}</span>}
        </div>
      )}
      {online && participant?.role === "spectator" && (
        <div className="lobby-actions">
          <button type="button" className="subtle" onClick={() => void copyInviteLink()}>Copy invite link</button>
          <button type="button" className="subtle" onClick={onLeaveRoom}>Leave room</button>
          {inviteStatus && <span className="invite-status" role="status">{inviteStatus}</span>}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

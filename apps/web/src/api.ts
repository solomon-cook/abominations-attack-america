import { COMMAND_PROTOCOL_VERSION, type GameCommand, type GameCommandEnvelope, type SetupAction } from "@abominations/game-engine";
import type { AccountGameSummary, AccountPrivacySettings, AccountSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats, PublicReplayExport, PublicReplayPage, PublicRoomSummary, RoomPrivacy, RoomSocketServerMessage, RoomView, SessionResponse, SocialSummary } from "@abominations/shared";
import { resolveApiBaseUrl } from "./api-origin";

const API_URL = resolveApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.DEV ? "http://localhost:8787" : `${window.location.origin}/api`);
const connectionId = () => {
  const key = "abominations-connection-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export const createRoom = (maxPlayers = 4, displayName = "Player 1", privacy: RoomPrivacy = "private") => request<SessionResponse>("/rooms", { method: "POST", body: JSON.stringify({ maxPlayers, displayName, privacy }) });
export const listPublicRooms = () => request<PublicRoomSummary[]>("/rooms/public");
export const joinRoom = (code: string, displayName: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/join`, { method: "POST", body: JSON.stringify({ displayName }) });
export const spectateRoom = (code: string, displayName: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/spectate`, { method: "POST", body: JSON.stringify({ displayName }) });
export const markDisconnected = (code: string, token: string) => request<RoomView>(`/rooms/${code.toUpperCase()}/disconnect`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: connectionId() }) });
export const markReconnected = (code: string, token: string) => request<RoomView>(`/rooms/${code.toUpperCase()}/reconnect`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: connectionId() }) });
export const rotateSession = (code: string, token: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/rotate-session`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const claimRoomSeat = (code: string, token: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/claim`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const createWebSocketTicket = (code: string, token: string) => request<{ ticket: string }>(`/rooms/${code.toUpperCase()}/ws-ticket`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const resumeAccountGame = (roomId: string) => request<SessionResponse>(`/accounts/me/games/${encodeURIComponent(roomId)}/resume`, { method: "POST", body: "{}" });
export const getAccount = () => request<{ account: AccountSummary }>("/accounts/me");
export const registerAccount = (email: string, password: string) => request<{ account?: AccountSummary; message: string; developmentLink?: string }>("/accounts/register", { method: "POST", body: JSON.stringify({ email, password }) });
export const loginAccount = (email: string, password: string) => request<{ account: AccountSummary; message: string }>("/accounts/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logoutAccount = () => request<{ message: string }>("/accounts/logout", { method: "POST", body: "{}" });
export const verifyAccountEmail = (token: string) => request<{ account: AccountSummary; message: string }>("/accounts/verify-email", { method: "POST", body: JSON.stringify({ token }) });
export const resendAccountVerification = (email: string) => request<{ message: string; developmentLink?: string }>("/accounts/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
export const requestAccountPasswordReset = (email: string) => request<{ message: string; developmentLink?: string }>("/accounts/password-reset", { method: "POST", body: JSON.stringify({ email }) });
export const completeAccountPasswordReset = (token: string, password: string) => request<{ message: string }>("/accounts/password-reset/complete", { method: "POST", body: JSON.stringify({ token, password }) });
export const updateAccountUsername = (username: string) => request<{ account: AccountSummary }>("/accounts/me", { method: "PATCH", body: JSON.stringify({ username }) });
export const deleteAccount = () => request<{ message: string }>("/accounts/me", { method: "DELETE" });
export const getAccountGames = () => request<AccountGameSummary[]>("/accounts/me/games");
export const getAccountStats = () => request<PlayerStats>("/accounts/me/stats");
export const getAccountPrivacySettings = () => request<AccountPrivacySettings>("/accounts/me/privacy");
export const updateAccountPrivacySettings = (publicStatsEnabled: boolean) => request<AccountPrivacySettings>("/accounts/me/privacy", { method: "PATCH", body: JSON.stringify({ publicStatsEnabled }) });
export const getSocialSummary = () => request<SocialSummary>("/accounts/me/social");
export const sendFriendInvitation = (username: string) => request<{ message: string }>("/accounts/me/friends/invitations", { method: "POST", body: JSON.stringify({ username }) });
export const respondToFriendInvitation = (id: string, action: "accept" | "decline" | "revoke") => request<{ message: string }>(`/accounts/me/friends/invitations/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
export const removeFriend = (username: string) => request<{ message: string }>(`/accounts/me/friends/${encodeURIComponent(username)}`, { method: "DELETE" });
export const saveOpponent = (username: string) => request<{ message: string }>(`/accounts/me/saved-opponents/${encodeURIComponent(username)}`, { method: "POST", body: "{}" });
export const removeSavedOpponent = (username: string) => request<{ message: string }>(`/accounts/me/saved-opponents/${encodeURIComponent(username)}`, { method: "DELETE" });
export const setPresence = (enabled: boolean) => request<{ message: string }>("/accounts/me/presence", { method: "PATCH", body: JSON.stringify({ enabled }) });
export const refreshPresence = () => request<{ message: string }>("/accounts/me/presence/heartbeat", { method: "POST", body: "{}" });
export const createFriendInviteLink = () => request<{ id: string; url: string; expiresAt: string }>("/accounts/me/friend-invite-links", { method: "POST", body: "{}" });
export const acceptFriendInviteLink = (token: string) => request<{ message: string }>("/accounts/me/friend-invite-links/accept", { method: "POST", body: JSON.stringify({ token }) });
export const revokeFriendInviteLink = (id: string) => request<{ message: string }>(`/accounts/me/friend-invite-links/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getPlayerProfile = (username: string) => request<PlayerStats & { botAssistedMatches: number }>(`/players/${encodeURIComponent(username)}`);
export const getLeaderboard = (category: LeaderboardCategory) => request<LeaderboardEntry[]>(`/leaderboard?category=${encodeURIComponent(category)}`);
export const setReady = (code: string, token: string, ready: boolean) => request<RoomView>(`/rooms/${code.toUpperCase()}/ready`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ ready }) });
export const startMatch = (code: string, token: string) => request<RoomView>(`/rooms/${code.toUpperCase()}/start`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const sendSetupAction = (code: string, token: string, expectedRevision: number, action: SetupAction) => request<RoomView>(`/rooms/${code.toUpperCase()}/setup`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ expectedRevision, action }) });
export const readRoom = (code: string, token: string, afterVersion = 0) => request<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}&afterVersion=${afterVersion}`);
export const readPublicReplay = (code: string, fromVersion = 0, limit = 8) => request<PublicReplayPage>(`/rooms/${code.toUpperCase()}/replay?fromVersion=${fromVersion}&limit=${limit}`);
export const exportPublicReplay = (code: string) => request<PublicReplayExport>(`/rooms/${code.toUpperCase()}/replay/export`);
export class SocketUnavailableError extends Error {}

export class RoomCommandChannel {
  private pending = new Map<string, { resolve: (room: RoomView) => void; reject: (error: Error) => void; timeout: number }>();
  private disposed = false;

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose);
    socket.addEventListener("error", this.onClose);
  }

  submit(envelope: GameCommandEnvelope): Promise<RoomView> {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new SocketUnavailableError("The room connection is unavailable."));
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.rejectPending(envelope.actionId, new SocketUnavailableError("The room connection did not confirm the action."));
      }, 8000);
      this.pending.set(envelope.actionId, { resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ type: "command.submit", envelope }));
      } catch {
        this.rejectPending(envelope.actionId, new SocketUnavailableError("The room connection could not send the action."));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("close", this.onClose);
    this.socket.removeEventListener("error", this.onClose);
    for (const actionId of this.pending.keys()) this.rejectPending(actionId, new SocketUnavailableError("The room connection closed."));
  }

  private onMessage = (event: MessageEvent) => {
    let message: RoomSocketServerMessage;
    try {
      message = JSON.parse(String(event.data)) as RoomSocketServerMessage;
    } catch {
      return;
    }
    if (message.type === "command.accepted") {
      this.resolvePending(message.actionId, message.room);
    } else if (message.type === "command.rejected") {
      this.rejectPending(message.actionId, new Error(message.error));
    } else if (message.type === "protocol.error") {
      for (const actionId of this.pending.keys()) this.rejectPending(actionId, new Error(message.error));
    }
  };

  private onClose = () => {
    for (const actionId of this.pending.keys()) this.rejectPending(actionId, new SocketUnavailableError("The room connection closed."));
  };

  private resolvePending(actionId: string, room: RoomView): void {
    const pending = this.pending.get(actionId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(actionId);
    pending.resolve(room);
  }

  private rejectPending(actionId: string, error: Error): void {
    const pending = this.pending.get(actionId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(actionId);
    pending.reject(error);
  }
}

export const sendCommand = async (
  code: string,
  token: string,
  actorId: string,
  expectedRevision: number,
  command: GameCommand,
  channel?: RoomCommandChannel | null,
) => {
  const envelope: GameCommandEnvelope = {
    actionId: crypto.randomUUID(),
    actorId,
    expectedRevision,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command,
  };
  if (channel) {
    try {
      return await channel.submit(envelope);
    } catch (error) {
      if (!(error instanceof SocketUnavailableError)) throw error;
      // Reuse the action ID so a command accepted just before a disconnect is idempotent.
    }
  }
  return request<RoomView>(`/rooms/${code}/actions`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ envelope }) });
};
export const websocketUrl = (code: string, ticket: string) => `${API_URL.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticket)}`;
export const websocketTransportEnabled = import.meta.env.VITE_ENABLE_WEBSOCKETS !== "false";

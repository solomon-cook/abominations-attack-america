import { COMMAND_PROTOCOL_VERSION, type GameCommand, type GameCommandEnvelope, type SetupAction } from "@abominations/game-engine";
import type { AccountDashboard, AccountGameSummary, AccountPrivacySettings, AccountSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats, PublicReplayExport, PublicReplayPage, PublicRoomSummary, RoomActionResult, RoomPrivacy, RoomSocketServerMessage, RoomView, SessionResponse, SocialSummary } from "@abominations/shared";
import { ConvexClient } from "convex/browser";
import { api as convexApi } from "../../../convex/_generated/api.js";
import { resolveApiBaseUrl } from "./api-origin";

const convexUrl = import.meta.env.VITE_CONVEX_URL || __APP_CONVEX_URL__;
const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL || __APP_CONVEX_SITE_URL__;
export const convexRealtimeEnabled = Boolean(convexUrl);
export const websocketTransportEnabled = !convexRealtimeEnabled
  && (!import.meta.env.DEV || Boolean(import.meta.env.VITE_API_URL))
  && (import.meta.env.VITE_ENABLE_WEBSOCKETS === "true"
    || (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_WEBSOCKETS !== "false"));
const explicitApiOrigin = convexRealtimeEnabled && (!import.meta.env.DEV || convexSiteUrl) ? undefined : import.meta.env.VITE_API_URL;
const defaultApiOrigin = import.meta.env.DEV
  ? (convexSiteUrl ? "/api" : "http://localhost:8787")
  : `${window.location.origin}${convexRealtimeEnabled ? "/api" : "/api/game"}`;
const API_URL = resolveApiBaseUrl(explicitApiOrigin, defaultApiOrigin);
let convexClient: ConvexClient | undefined;
function getConvexClient() {
  if (!convexUrl) throw new Error("Convex is not configured for this web build.");
  return convexClient ??= new ConvexClient(convexUrl);
}
async function hashRoomToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function subscribeRoom(code: string, token: string, onUpdate: (room: RoomView) => void, onError: (error: Error) => void) {
  let disposed = false;
  let unsubscribeState: (() => void) | undefined;
  let unsubscribeParticipants: (() => void) | undefined;
  let roomState: Omit<RoomView, "participants" | "events"> | undefined;
  let participants: RoomView["participants"] | undefined;
  const publish = () => {
    if (disposed || !roomState || !participants) return;
    onUpdate({ ...roomState, participants, events: [] });
  };
  void hashRoomToken(token).then((tokenHash) => {
    if (disposed) return;
    const client = getConvexClient();
    unsubscribeState = client.onUpdate(convexApi.rooms.readLiveState, { code: code.toUpperCase(), tokenHash }, (nextState) => {
      roomState = nextState;
      publish();
    }, onError);
    unsubscribeParticipants = client.onUpdate(convexApi.rooms.readParticipants, { tokenHash }, (nextParticipants) => {
      participants = nextParticipants;
      publish();
    }, onError);
  }).catch((error) => onError(error instanceof Error ? error : new Error("Could not subscribe to the room.")));
  return () => { disposed = true; unsubscribeState?.(); unsubscribeParticipants?.(); };
}
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

export const createRoom = (maxPlayers = 4, displayName = "Player 1", privacy: RoomPrivacy = "private") => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.create, { maxPlayers, displayName, privacy })
  : request<SessionResponse>("/rooms", { method: "POST", body: JSON.stringify({ maxPlayers, displayName, privacy }) });
export const listPublicRooms = async (): Promise<PublicRoomSummary[]> => convexRealtimeEnabled
  ? getConvexClient().query(convexApi.rooms.publicRooms, {}) as Promise<PublicRoomSummary[]>
  : request<PublicRoomSummary[]>("/rooms/public");
export const joinRoom = (code: string, displayName: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.join, { code: code.toUpperCase(), displayName })
  : request<SessionResponse>(`/rooms/${code.toUpperCase()}/join`, { method: "POST", body: JSON.stringify({ displayName }) });
export const addRoomBot = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.addBot, { code: code.toUpperCase(), token })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/bots`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const fillRoomWithBots = (code: string, token: string) => getConvexClient().mutation(convexApi.rooms.fillWithBots, { code: code.toUpperCase(), token });
export const setRoomPrivacy = (code: string, token: string, privacy: RoomPrivacy) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.setPrivacy, { code: code.toUpperCase(), token, privacy })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/privacy`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ privacy }) });
export const takeOverRoomWithBot = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.takeOverWithBot, { code: code.toUpperCase(), token })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/bot-takeover`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const deleteRoom = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.deleteRoom, { code: code.toUpperCase(), token })
  : request<{ ok: true }>(`/rooms/${code.toUpperCase()}`, { method: "DELETE", headers: { "x-room-token": token } });
export const spectateRoom = (code: string, displayName: string, viewerToken?: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.spectate, { code: code.toUpperCase(), displayName, ...(viewerToken ? { viewerToken } : {}) })
  : request<SessionResponse>(`/rooms/${code.toUpperCase()}/spectate`, { method: "POST", body: JSON.stringify({ displayName, ...(viewerToken ? { viewerToken } : {}) }) });
export const createViewerInvite = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.createViewerInvite, { code: code.toUpperCase(), token })
  : request<{ token: string; expiresAt: string }>(`/rooms/${code.toUpperCase()}/viewer-link`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const markDisconnected = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.disconnect, { code: code.toUpperCase(), token, connectionId: connectionId() })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/disconnect`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: connectionId() }) });
export const markReconnected = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.reconnect, { code: code.toUpperCase(), token, connectionId: connectionId() }) as Promise<{ ok: true }>
  : request<RoomView>(`/rooms/${code.toUpperCase()}/reconnect`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: connectionId() }) });
export const heartbeatRoom = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.heartbeat, { code: code.toUpperCase(), token, connectionId: connectionId() })
  : request<{ ok: true; at: number }>(`/rooms/${code.toUpperCase()}/heartbeat`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: connectionId() }) });
export const rotateSession = (code: string, token: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/rotate-session`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const claimRoomSeat = (code: string, token: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/claim`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const createWebSocketTicket = (code: string, token: string) => request<{ ticket: string }>(`/rooms/${code.toUpperCase()}/ws-ticket`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const resumeAccountGame = (roomId: string) => request<SessionResponse>(`/accounts/me/games/${encodeURIComponent(roomId)}/resume`, { method: "POST", body: "{}" });
export const getAccount = () => request<{ account: AccountSummary }>("/accounts/me");
export const getAccountDashboard = async (): Promise<AccountDashboard | null> => {
  if (convexRealtimeEnabled) return request<AccountDashboard | null>("/accounts/me/dashboard");
  try {
    const { account } = await getAccount();
    const [games, stats, social, privacy] = await Promise.all([getAccountGames(), getAccountStats(), getSocialSummary(), getAccountPrivacySettings()]);
    return { account, games, stats, social, privacy };
  } catch {
    return null;
  }
};
export const registerAccount = (username: string, password: string) => request<{ account: AccountSummary; message: string }>("/accounts/register", { method: "POST", body: JSON.stringify({ username, password }) });
export const loginAccount = (username: string, password: string) => request<{ account: AccountSummary; message: string }>("/accounts/login", { method: "POST", body: JSON.stringify({ username, password }) });
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
export const setReady = (code: string, token: string, ready: boolean) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.ready, { code: code.toUpperCase(), token, ready })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/ready`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ ready }) });
export const startMatch = (code: string, token: string) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.start, { code: code.toUpperCase(), token })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/start`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
export const sendSetupAction = (code: string, token: string, expectedRevision: number, action: SetupAction) => convexRealtimeEnabled
  ? getConvexClient().mutation(convexApi.rooms.setup, { code: code.toUpperCase(), token, expectedRevision, action })
  : request<RoomView>(`/rooms/${code.toUpperCase()}/setup`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ expectedRevision, action }) });
export const readRoom = async (code: string, token: string, afterVersion = 0) => convexRealtimeEnabled
  ? (async () => {
      const tokenHash = await hashRoomToken(token);
      const [roomState, participants] = await Promise.all([
        getConvexClient().query(convexApi.rooms.readLiveState, { code: code.toUpperCase(), tokenHash }),
        getConvexClient().query(convexApi.rooms.readParticipants, { tokenHash }),
      ]);
      return { ...roomState, participants, events: [] };
    })()
  : request<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}&afterVersion=${afterVersion}`);
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

  get isOpen(): boolean {
    return !this.disposed && this.socket.readyState === WebSocket.OPEN;
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
): Promise<RoomView | RoomActionResult> => {
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
  if (convexRealtimeEnabled) return getConvexClient().mutation(convexApi.rooms.submit, { code: code.toUpperCase(), token, envelope });
  return request<RoomView>(`/rooms/${code}/actions`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ envelope }) });
};
export const websocketUrl = (code: string, ticket: string) => `${API_URL.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticket)}`;

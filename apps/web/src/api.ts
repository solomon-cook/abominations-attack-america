import { COMMAND_PROTOCOL_VERSION, type GameCommand, type GameCommandEnvelope, type SetupAction } from "@abominations/game-engine";
import type { AccountGameSummary, AccountSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats, PublicRoomSummary, RoomPrivacy, RoomSocketServerMessage, RoomView, SessionResponse } from "@abominations/shared";
import { ConnectionLeaseState } from "./connection-lease";
import { CommandAckTracker } from "./command-ack";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const connectionLeases = new ConnectionLeaseState(sessionStorage, () => crypto.randomUUID());

class ApiResponseError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function retryLeaseRequest<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const retryable = error instanceof TypeError || (error instanceof ApiResponseError && error.status >= 500);
      if (!retryable || attempt >= 2) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new ApiResponseError(response.status, data.error ?? "Request failed");
  return data as T;
}

export const createRoom = async (maxPlayers = 4, displayName = "Player 1", privacy: RoomPrivacy = "private") => {
  const result = await request<SessionResponse>("/rooms", { method: "POST", body: JSON.stringify({ maxPlayers, displayName, privacy }) });
  connectionLeases.clear(result.room.code);
  return result;
};
export const listPublicRooms = () => request<PublicRoomSummary[]>("/rooms/public");
export const joinRoom = async (code: string, displayName: string) => {
  const result = await request<SessionResponse>(`/rooms/${code.toUpperCase()}/join`, { method: "POST", body: JSON.stringify({ displayName }) });
  connectionLeases.clear(result.room.code);
  return result;
};
export const spectateRoom = async (code: string, displayName: string) => {
  const result = await request<SessionResponse>(`/rooms/${code.toUpperCase()}/spectate`, { method: "POST", body: JSON.stringify({ displayName }) });
  connectionLeases.clear(result.room.code);
  return result;
};
export const markDisconnected = async (code: string, token: string, cancelPendingReconnect = false) => {
  const pendingConnectionId = cancelPendingReconnect ? connectionLeases.requested(code) : undefined;
  const result = await request<RoomView>(`/rooms/${code.toUpperCase()}/disconnect`, {
    method: "POST",
    headers: { "x-room-token": token },
    body: JSON.stringify({ connectionId: connectionLeases.current(code), ...(pendingConnectionId ? { pendingConnectionId } : {}) }),
  });
  if (pendingConnectionId) connectionLeases.cancel(code, pendingConnectionId);
  return result;
};
export const markReconnected = async (code: string, token: string) => connectionLeases.issue(code, `${code.toUpperCase()}:${token}`, "reconnect", ({ expectedConnectionId, requestedConnectionId }) => retryLeaseRequest(() => request<RoomView & { connectionId: string }>(`/rooms/${code.toUpperCase()}/reconnect`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: expectedConnectionId, requestedConnectionId }) }))).then((result) => {
  const { connectionId: _connectionId, ...room } = result;
  return room;
});
export const rotateSession = async (code: string, token: string) => {
  const result = await request<SessionResponse>(`/rooms/${code.toUpperCase()}/rotate-session`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
  connectionLeases.clear(code);
  return result;
};
export const claimRoomSeat = async (code: string, token: string) => {
  const result = await request<SessionResponse>(`/rooms/${code.toUpperCase()}/claim`, { method: "POST", headers: { "x-room-token": token }, body: "{}" });
  connectionLeases.clear(code);
  return result;
};
export const createWebSocketTicket = async (code: string, token: string) => connectionLeases.issue(code, `${code.toUpperCase()}:${token}`, "ticket", ({ expectedConnectionId, requestedConnectionId }) => retryLeaseRequest(() => request<{ ticket: string; connectionId: string }>(`/rooms/${code.toUpperCase()}/ws-ticket`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ connectionId: expectedConnectionId, requestedConnectionId }) })));
export const resumeAccountGame = async (roomId: string) => {
  const result = await request<SessionResponse>(`/accounts/me/games/${encodeURIComponent(roomId)}/resume`, { method: "POST", body: "{}" });
  connectionLeases.clear(result.room.code);
  return result;
};
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
export const getPlayerProfile = (username: string) => request<PlayerStats & { botAssistedMatches: number }>(`/players/${encodeURIComponent(username)}`);
export const getLeaderboard = (category: LeaderboardCategory) => request<LeaderboardEntry[]>(`/leaderboard?category=${encodeURIComponent(category)}`);
export const setReady = (code: string, token: string, ready: boolean) => request<RoomView>(`/rooms/${code.toUpperCase()}/ready`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ ready }) });
export const sendSetupAction = (code: string, token: string, expectedRevision: number, action: SetupAction) => request<RoomView>(`/rooms/${code.toUpperCase()}/setup`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ expectedRevision, action }) });
export const readRoom = (code: string, token: string, afterVersion = 0) => request<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}&afterVersion=${afterVersion}`);
export class SocketUnavailableError extends Error {}

export class RoomCommandChannel {
  private pending = new Map<string, { resolve: (room: RoomView) => void; reject: (error: Error) => void; timeout: number }>();
  private acknowledgements = new CommandAckTracker();
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
      this.acknowledgements.register(envelope.actionId);
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
      const room = this.acknowledgements.acknowledge(message.actionId, message.version);
      if (room) this.resolvePending(message.actionId, room);
    } else if (message.type === "room.updated") {
      for (const actionId of this.acknowledgements.update(message.room)) this.resolvePending(actionId, message.room);
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
    this.acknowledgements.forget(actionId);
    pending.resolve(room);
  }

  private rejectPending(actionId: string, error: Error): void {
    const pending = this.pending.get(actionId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(actionId);
    this.acknowledgements.forget(actionId);
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

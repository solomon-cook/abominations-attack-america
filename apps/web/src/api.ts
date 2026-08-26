import { COMMAND_PROTOCOL_VERSION, type GameCommand, type SetupAction } from "@abominations/game-engine";
import type { PublicRoomSummary, RoomPrivacy, RoomView, SessionResponse } from "@abominations/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const connectionId = () => {
  const key = "abominations-connection-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
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
export const setReady = (code: string, token: string, ready: boolean) => request<RoomView>(`/rooms/${code.toUpperCase()}/ready`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ ready }) });
export const sendSetupAction = (code: string, token: string, expectedRevision: number, action: SetupAction) => request<RoomView>(`/rooms/${code.toUpperCase()}/setup`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ expectedRevision, action }) });
export const readRoom = (code: string, token: string, afterVersion = 0) => request<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}&afterVersion=${afterVersion}`);
export const sendCommand = (code: string, token: string, actorId: string, expectedRevision: number, command: GameCommand) => request<RoomView>(`/rooms/${code}/actions`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ envelope: { actionId: crypto.randomUUID(), actorId, expectedRevision, protocolVersion: COMMAND_PROTOCOL_VERSION, command } }) });
export const websocketUrl = (code: string, token: string) => `${API_URL.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;

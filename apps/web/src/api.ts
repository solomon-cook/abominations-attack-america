import type { GameCommand } from "@abominations/game-engine";
import type { RoomView, SessionResponse } from "@abominations/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export const createRoom = (maxPlayers = 4) => request<SessionResponse>("/rooms", { method: "POST", body: JSON.stringify({ maxPlayers }) });
export const joinRoom = (code: string, displayName: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/join`, { method: "POST", body: JSON.stringify({ displayName }) });
export const spectateRoom = (code: string, displayName: string) => request<SessionResponse>(`/rooms/${code.toUpperCase()}/spectate`, { method: "POST", body: JSON.stringify({ displayName }) });
export const readRoom = (code: string, token: string, afterVersion = 0) => request<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}&afterVersion=${afterVersion}`);
export const sendCommand = (code: string, token: string, command: GameCommand) => request<RoomView>(`/rooms/${code}/actions`, { method: "POST", headers: { "x-room-token": token }, body: JSON.stringify({ actionId: crypto.randomUUID(), command }) });
export const websocketUrl = (code: string, token: string) => `${API_URL.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;

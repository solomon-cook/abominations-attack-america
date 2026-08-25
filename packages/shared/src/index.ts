export type Platform = "web" | "ios" | "tvos" | "desktop";
export type PlayerId = string;

export interface RoomParticipant {
  id: string;
  displayName: string;
  role: "player" | "spectator";
  platform: Platform;
}

import type { GameState } from "@abominations/game-engine";

export type RoomStatus = "waiting" | "active" | "completed" | "abandoned";
export type ParticipantRole = "player" | "spectator";

export interface RoomEvent {
  id: string;
  roomId: string;
  version: number;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RoomParticipantView {
  id: string;
  displayName: string;
  role: ParticipantRole;
  playerIndex?: number;
  connected: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  version: number;
  state: GameState;
  participants: RoomParticipantView[];
  events: RoomEvent[];
}

export type GameCommand =
  | { type: "move"; destination: string }
  | { type: "advance" };

export interface SessionResponse {
  room: RoomView;
  participantId: string;
  token: string;
}

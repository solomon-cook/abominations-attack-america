export type Platform = "web" | "ios" | "tvos" | "desktop";
export type PlayerId = string;

export interface RoomParticipant {
  id: string;
  displayName: string;
  role: "player" | "spectator";
  platform: Platform;
}

import type { GameState } from "@abominations/game-engine";

export type RoomStatus = "waiting" | "active" | "completed" | "abandoned" | "expired";
export type RoomPrivacy = "private" | "public";
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
  ready: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  privacy: RoomPrivacy;
  version: number;
  state: GameState;
  participants: RoomParticipantView[];
  events: RoomEvent[];
}

export type GameCommand =
  | { type: "move"; path: string[] }
  | { type: "move-unit"; unitId: string; path: string[] }
  | { type: "disappear-monster" }
  | { type: "pass-move" }
  | { type: "resolve-fight"; battleId?: string; spendInfamy?: number; targetUnitId?: string }
  | { type: "use-mutation"; cardId: "Berserk" | "Son of a Monster"; battleId?: string }
  | { type: "use-research"; cardId: "Defense Satellites" | "Antimatter" | "Stabilizer Ray" | "Laser Fence"; battleId?: string; mutationCardId?: string; choice?: "infamy" | "retreat"; destination?: string }
  | { type: "resolve-encounter"; choice?: "health" | "infamy"; trophyUnitId?: string }
  | { type: "deploy" }
  | { type: "draw-research" }
  | { type: "pass-deploy" }
  | { type: "concede" }
  | { type: "advance" };

export interface SessionResponse {
  room: RoomView;
  participantId: string;
  token: string;
}

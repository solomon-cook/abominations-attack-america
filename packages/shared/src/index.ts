export type Platform = "web" | "ios" | "tvos" | "desktop";
export type PlayerId = string;

/** @deprecated Use RoomParticipantView for public room projections. */
export interface RoomParticipant {
  id: string;
  displayName: string;
  role: "player" | "spectator";
  platform: Platform;
}

import type { GameState } from "@abominations/game-engine";
import type { GameCommandEnvelope } from "@abominations/game-engine";
import type { EngineEventType } from "@abominations/game-engine";

export type RoomStatus = "waiting" | "active" | "completed" | "abandoned" | "expired";
export type RoomPrivacy = "private" | "public";
export type ParticipantRole = "player" | "spectator";
export type KnownRoomEventType = EngineEventType | "setup.updated";

/** Type-checks event names created now while preserving open strings when reading persisted history. */
export function knownRoomEventType<T extends KnownRoomEventType>(type: T): T {
  return type;
}

type Assert<T extends true> = T;
type UnknownRoomEventTypeIsRejected = Assert<"unknown.room.event" extends KnownRoomEventType ? false : true>;

export interface RoomEvent {
  id: string;
  roomId: string;
  version: number;
  actorId: string;
  type: string;
  controlSource?: "human" | "bot";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RoomParticipantView {
  id: string;
  displayName: string;
  username?: string;
  role: ParticipantRole;
  playerIndex?: number;
  connected: boolean;
  ready: boolean;
  botControlled?: boolean;
  botAssisted?: boolean;
}

export type LeaderboardCategory = "wins" | "win-rate" | "stomped-tiles" | "damage-taken" | "health-gained" | "luck";

export interface PlayerStats {
  username: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  stompedTiles: number;
  damageTaken: number;
  healthGained: number;
  luckTotal: number;
  luckRolls: number;
  luckAverage: number | null;
  monsterChoices: Record<string, number>;
  branchChoices: Record<string, number>;
  mostChosenMonster?: string;
  mostChosenBranch?: string;
}

export interface LeaderboardEntry extends PlayerStats {
  rank: number;
  value: number;
}

export interface AccountSummary {
  id: string;
  username: string;
  emailVerified: boolean;
}

export interface AccountGameSummary {
  roomId: string;
  code: string;
  status: RoomStatus;
  privacy: RoomPrivacy;
  playerIndex: number;
  displayName: string;
  botControlled: boolean;
  botAssisted: boolean;
  completedAt?: string;
  outcome?: "win" | "loss" | "tie";
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

export type RoomSocketClientMessage = {
  type: "command.submit";
  envelope: GameCommandEnvelope;
};

export type RoomSocketServerMessage =
  | { type: "room.updated"; room: RoomView }
  | { type: "command.accepted"; actionId: string; version: number }
  | { type: "command.rejected"; actionId: string; error: string }
  | { type: "protocol.error"; error: string };

export interface PublicRoomSummary {
  code: string;
  status: Extract<RoomStatus, "waiting" | "active">;
  maxPlayers: number;
  playerCount: number;
  spectatorCount: number;
}

export type { GameCommand } from "@abominations/game-engine";

export interface SessionResponse {
  room: RoomView;
  participantId: string;
  token: string;
  accountLinked?: boolean;
}

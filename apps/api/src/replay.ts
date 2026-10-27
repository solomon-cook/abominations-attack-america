import { applyCommandEnvelope, applyCompletedSetup, applySetupAction, projectState, type GameCommand, type GameState, type SetupAction } from "@abominations/game-engine";
import type { ReplayFrame } from "@abominations/shared";

export type ReplayCommandRecord =
  | { kind: "setup"; playerIndex: number; action: SetupAction }
  | { kind: "command"; playerIndex: number; command: GameCommand }
  | { kind: "start" };

export interface ReplaySourceEvent {
  version: number;
  eventType: string;
  record: ReplayCommandRecord;
}

export const MAX_REPLAY_VERSIONS = 2048;
export const MAX_REPLAY_PAGE_FRAMES = 12;
export const MAX_REPLAY_PAGE_BYTES = 700_000;
export const MAX_REPLAY_EXPORT_BYTES = 8_000_000;
const MAX_REPLAY_CACHE_ENTRY_BYTES = 8_000_000;
const MAX_REPLAY_CACHE_BYTES = 16_000_000;

type CachedReplay = { version: number; frames: ReplayFrame[]; bytes: number };
const replayFrameCache = new Map<string, CachedReplay>();
let replayFrameCacheBytes = 0;

export function getCachedReplayFrames(key: string, version: number): ReplayFrame[] | undefined {
  const entry = replayFrameCache.get(key);
  if (!entry || entry.version !== version) return undefined;
  replayFrameCache.delete(key);
  replayFrameCache.set(key, entry);
  return entry.frames;
}

export function cacheReplayFrames(key: string, version: number, frames: ReplayFrame[]): void {
  const bytes = Buffer.byteLength(JSON.stringify(frames));
  if (bytes > MAX_REPLAY_CACHE_ENTRY_BYTES) return;
  const previous = replayFrameCache.get(key);
  if (previous) {
    replayFrameCacheBytes -= previous.bytes;
    replayFrameCache.delete(key);
  }
  while (replayFrameCacheBytes + bytes > MAX_REPLAY_CACHE_BYTES) {
    const oldestKey = replayFrameCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = replayFrameCache.get(oldestKey)!;
    replayFrameCacheBytes -= oldest.bytes;
    replayFrameCache.delete(oldestKey);
  }
  replayFrameCache.set(key, { version, frames, bytes });
  replayFrameCacheBytes += bytes;
}

export function publicReplayState(state: GameState): GameState {
  const projected = projectState(state, "spectator");
  projected.matchId = "public-replay";
  projected.eventLog = [];
  return projected;
}

function replayStateMatches(left: GameState, right: GameState): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)).map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return value;
  };
  const normalize = (state: GameState) => {
    const copy = structuredClone(state);
    copy.matchId = "replay-comparison";
    copy.eventLog = [];
    return canonicalize(copy);
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function reconstructReplay(
  initialState: GameState,
  events: readonly ReplaySourceEvent[],
  finalState: GameState,
  finalVersion: number,
  visit: (frame: ReplayFrame) => void,
): "ok" | "history-incomplete" | "history-too-large" | "unsupported-content" {
  if (finalVersion > MAX_REPLAY_VERSIONS) return "history-too-large";
  if (!Number.isInteger(finalVersion) || finalVersion < 0 || events.length !== finalVersion) return "history-incomplete";
  if (initialState.schemaVersion !== 2) return "unsupported-content";

  let state = structuredClone(initialState);
  visit({ version: 0, eventType: "match.created", state: publicReplayState(state) });
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const version = index + 1;
    if (event.version !== version) return "history-incomplete";
    try {
      if (event.record.kind === "setup") {
        if (event.eventType !== "setup.updated" || !state.setupState) return "history-incomplete";
        const setupState = applySetupAction(state.setupState, event.record.playerIndex, event.record.action);
        state = { ...state, setupState, ...(setupState.phase === "complete" ? { setupAssignments: setupState.seats } : {}) };
      } else if (event.record.kind === "start") {
        if (event.eventType !== "match.started") return "history-incomplete";
        state = applyCompletedSetup(state);
      } else {
        const result = applyCommandEnvelope(state, {
          actionId: `replay-${version}`,
          actorId: `seat-${event.record.playerIndex}`,
          expectedRevision: version - 1,
          protocolVersion: 1,
          command: event.record.command,
        }, version - 1);
        if (result.eventType !== event.eventType) return "history-incomplete";
        state = result.state;
      }
    } catch {
      return "unsupported-content";
    }
    visit({ version, eventType: event.eventType, state: publicReplayState(state) });
  }
  return replayStateMatches(state, finalState) ? "ok" : "history-incomplete";
}

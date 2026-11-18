import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { MAX_REPLAY_EXPORT_BYTES, MAX_REPLAY_PAGE_BYTES, MAX_REPLAY_PAGE_FRAMES, MAX_REPLAY_VERSIONS, reconstructReplay, type ReplayCommandRecord, type ReplaySourceEvent } from "../apps/api/src/replay.js";
import { publicReplayState } from "../apps/api/src/replay.js";
import type { GameState } from "../packages/game-engine/src/index.js";
import type { PublicReplayExport, PublicReplayPage, ReplayFrame } from "../packages/shared/src/index.js";
import { decodeGameState } from "./gameStateStorage.js";

export const getSource = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code.toUpperCase())).unique();
    if (!room || room.privacy !== "public") return { kind: "not-found" as const };
    if (room.status !== "completed") return { kind: "not-completed" as const };
    const [events, replaySeed] = await Promise.all([
      ctx.db.query("events").withIndex("by_room_version", (q) => q.eq("roomId", room.externalId)).order("asc").take(MAX_REPLAY_VERSIONS + 1),
      ctx.db.query("roomReplaySeeds").withIndex("by_room", (q) => q.eq("roomId", room.externalId)).unique(),
    ]);
    return {
      kind: "ready" as const,
      room: {
        code: room.code, version: room.version,
        initial: replaySeed?.initialState
          ? decodeGameState(replaySeed.initialState)
          : room.initialReplayState ? decodeGameState(room.initialReplayState) : undefined,
        final: decodeGameState(room.state),
      },
      events: events.map((event) => ({
        version: event.version, eventType: event.type,
        record: event.replayCommand as ReplayCommandRecord | undefined,
      })),
    };
  },
});

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
type ReplayFailure = Extract<PublicReplayPage, { replayable: false }>["reason"];
const pageFailure = (reason: string | undefined): ReplayFailure => reason === "history-too-large"
  ? "history-too-large"
  : reason === "unsupported-content" ? "unsupported-content" : "history-incomplete";
const exportFailure = (reason: string | undefined): Extract<PublicReplayExport, { replayable: false }>["reason"] => reason === "history-too-large"
  ? "history-too-large"
  : reason === "unsupported-content" ? "unsupported-content" : "history-incomplete";
const sourceFor = (events: Array<{ version: number; eventType: string; record?: ReplayCommandRecord }>): ReplaySourceEvent[] | undefined => {
  if (events.some((event) => event.record === undefined)) return undefined;
  return events.map((event) => ({ version: event.version, eventType: event.eventType, record: event.record! }));
};

function reconstruct(room: { code: string; version: number; initial?: GameState; final: GameState }, events: Array<{ version: number; eventType: string; record?: ReplayCommandRecord }>) {
  if (!room.initial) return { error: "history-incomplete" as const };
  if (events.length > MAX_REPLAY_VERSIONS) return { error: "history-too-large" as const };
  const sources = sourceFor(events);
  if (!sources) return { error: "history-incomplete" as const };
  const frames: ReplayFrame[] = [];
  const result = reconstructReplay(room.initial, sources, room.final, room.version, (frame) => frames.push(frame));
  return result === "ok" ? { frames } : { error: result ?? "history-incomplete" };
}

export const page = action({
  args: { code: v.string(), fromVersion: v.number(), limit: v.number() },
  handler: async (ctx, args): Promise<PublicReplayPage> => {
    const source = await ctx.runQuery(internal.replays.getSource, { code: args.code });
    if (source.kind === "not-found") return { replayable: false, reason: "not-found" };
    if (source.kind === "not-completed") return { replayable: false, reason: "not-completed" };
    if (!Number.isInteger(args.fromVersion) || args.fromVersion < 0 || args.fromVersion > source.room.version
      || !Number.isInteger(args.limit) || args.limit < 1) throw new Error("Replay pagination is invalid.");
    const replay = reconstruct(source.room, source.events);
    if ("error" in replay) return { replayable: false, reason: pageFailure(replay.error) };
    const limit = Math.min(args.limit, MAX_REPLAY_PAGE_FRAMES);
    const base = replay.frames[args.fromVersion];
    if (!base || base.version !== args.fromVersion) return { replayable: false, reason: "history-incomplete" };
    const resultBase: PublicReplayPage = {
      replayable: true,
      roomCode: source.room.code,
      terminalVersion: source.room.version,
      boardId: source.room.initial!.boardId,
      boardVersion: source.room.initial!.boardVersion,
      boardContentHash: source.room.initial!.boardContentHash,
      rulesetVersion: source.room.initial!.rulesetVersion,
      base: structuredClone(base),
      frames: [],
    };
    const frames: ReplayFrame[] = [];
    for (const frame of replay.frames.slice(args.fromVersion + 1, args.fromVersion + limit + 1)) {
      if (bytes({ ...resultBase, frames: [...frames, frame] }) > MAX_REPLAY_PAGE_BYTES) break;
      frames.push(structuredClone(frame));
    }
    if (!frames.length && args.fromVersion < source.room.version) {
      const next = replay.frames[args.fromVersion + 1];
      if (next && bytes({ ...resultBase, frames: [next] }) > MAX_REPLAY_PAGE_BYTES) return { replayable: false, reason: "frame-too-large" };
    }
    const lastVersion = frames.at(-1)?.version ?? base.version;
    const result: PublicReplayPage = { ...resultBase, frames, ...(lastVersion < source.room.version ? { nextFromVersion: lastVersion } : {}) };
    if (bytes(result) > MAX_REPLAY_PAGE_BYTES) return { replayable: false, reason: "frame-too-large" };
    return result;
  },
});

export const exportAll = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<PublicReplayExport> => {
    const source = await ctx.runQuery(internal.replays.getSource, { code });
    if (source.kind === "not-found") return { replayable: false, reason: "not-found" };
    if (source.kind === "not-completed") return { replayable: false, reason: "not-completed" };
    const replay = reconstruct(source.room, source.events);
    if ("error" in replay) return { replayable: false, reason: exportFailure(replay.error) };
    const result: PublicReplayExport = {
      replayable: true, formatVersion: 1, roomCode: source.room.code,
      terminalVersion: source.room.version,
      boardId: source.room.initial!.boardId,
      boardVersion: source.room.initial!.boardVersion,
      boardContentHash: source.room.initial!.boardContentHash,
      rulesetVersion: source.room.initial!.rulesetVersion,
      frames: replay.frames.map((frame) => ({ ...frame, state: publicReplayState(frame.state) })),
    };
    if (bytes(result) > MAX_REPLAY_EXPORT_BYTES) return { replayable: false, reason: "export-too-large" };
    return result;
  },
});

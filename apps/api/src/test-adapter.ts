import { createHash } from "node:crypto";
import { createGame } from "@abominations/game-engine";

/** Minimal persistence adapter shared by Prisma store contract tests. */
export function persistentAdapter() {
  const state = createGame(2);
  const room = { id: "room-1", code: "ABC123", status: "ACTIVE", privacy: "PUBLIC", maxPlayers: 2, version: 0, state, participants: [], events: [] };
  const actor = { id: "player-1", displayName: "Player 1", role: "PLAYER", playerIndex: 0, tokenHash: createHash("sha256").update("token").digest("hex"), sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), connectedAt: new Date() };
  const receipts = new Map<string, unknown>();
  const results = new Map<string, unknown>();
  const events: any[] = [];
  const adapter: any = {
    $queryRaw: async () => [{ "?column?": 1 }],
    gameRoom: {
      findUnique: async ({ include }: { include?: unknown }) => include ? { ...room, participants: [actor], events: [...events].reverse() } : room,
      updateMany: async ({ where, data }: { where: { version: number }; data: { state: unknown; version: number } }) => {
        if (where.version !== room.version) return { count: 0 };
        room.state = data.state as typeof state;
        room.version = data.version;
        if ("status" in data) room.status = data.status as string;
        return { count: 1 };
      },
      update: async ({ data }: { data: { status: string } }) => { room.status = data.status; return room; },
    },
    participant: {
      findFirst: async ({ where }: { where?: { tokenHash?: string; id?: string } } = {}) => {
        const criteria = where ?? {};
        if (criteria.tokenHash && criteria.tokenHash !== actor.tokenHash) return null;
        if (criteria.id && criteria.id !== actor.id) return null;
        return actor;
      },
      findMany: async () => [actor],
      update: async ({ data }: { data: { tokenHash?: string; sessionExpiresAt?: Date } }) => { Object.assign(actor, data); return actor; },
    },
    commandReceipt: { findUnique: async ({ where }: { where: { roomId_actionId: { actionId: string } } }) => receipts.get(where.roomId_actionId.actionId) ?? null },
    $transaction: async (callback: (tx: any) => Promise<void>) => callback({
      gameRoom: adapter.gameRoom,
      gameEvent: { create: async ({ data }: { data: any }) => events.push({ id: `event-${events.length}`, ...data, createdAt: new Date() }) },
      commandReceipt: { create: async ({ data }: { data: any }) => {
        if (receipts.has(data.actionId)) { const error = new Error("duplicate"); (error as Error & { code?: string }).code = "P2002"; throw error; }
        receipts.set(data.actionId, data);
      } },
      gameResult: { upsert: async ({ create }: { create: any }) => { results.set(room.id, create); } },
    }),
  };
  return { adapter, room, receipts, results };
}

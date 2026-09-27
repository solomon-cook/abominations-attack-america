import { createHash } from "node:crypto";
import { createGame } from "@abominations/game-engine";

/** Minimal persistence adapter shared by Prisma store contract tests. */
export function persistentAdapter() {
  const state = createGame(2);
  const room = { id: "room-1", code: "ABC123", status: "ACTIVE", privacy: "PUBLIC", maxPlayers: 2, version: 0, state, playerStats: [], isTest: false, lastActivityAt: new Date(), participants: [], events: [] };
  const actor = { id: "player-1", displayName: "Player 1", role: "PLAYER", playerIndex: 0, userId: null, tokenHash: createHash("sha256").update("token").digest("hex"), sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), connectedAt: new Date(), disconnectedAt: null, connectionId: null, botControlled: false, botAssisted: false, ready: false };
  const receipts = new Map<string, unknown>();
  const results = new Map<string, unknown>();
  const matchStats = new Map<string, unknown>();
  const events: any[] = [];
  const adapter: any = {
    $queryRaw: async () => [{ "?column?": 1 }],
    gameRoom: {
      findUnique: async ({ include }: { include?: unknown }) => include ? { ...room, participants: [actor], events: [...events].filter((event) => event.version > ((include as any).events?.where?.version?.gt ?? 0)).reverse().slice(0, (include as any).events?.take ?? 256) } : room,
      updateMany: async ({ where, data }: { where: { version?: number; status?: string }; data: any }) => {
        if (where.version !== undefined && where.version !== room.version) return { count: 0 };
        if (where.status !== undefined && where.status !== room.status) return { count: 0 };
        Object.assign(room, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: { status: string } }) => { room.status = data.status; return room; },
    },
    participant: {
      findFirst: async ({ where }: { where?: any } = {}) => {
        const criteria = where ?? {};
        if (criteria.tokenHash && criteria.tokenHash !== actor.tokenHash) return null;
        if (criteria.id && criteria.id !== actor.id) return null;
        if (criteria.botControlled !== undefined && criteria.botControlled !== (actor as any).botControlled) return null;
        if (criteria.connectionId !== undefined && criteria.connectionId !== (actor as any).connectionId) return null;
        if (criteria.connectedAt?.not === null && !(actor as any).connectedAt) return null;
        return actor;
      },
      count: async ({ where }: { where?: any } = {}) => where?.userId?.not === null ? 0 : 0,
      findMany: async ({ where }: { where?: any } = {}) => where?.userId?.not === null ? (actor.userId ? [actor] : []) : [actor],
      update: async ({ data }: { data: any }) => { Object.assign(actor, data); return actor; },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        if (where?.id && where.id !== actor.id) return { count: 0 };
        if (where?.tokenHash && where.tokenHash !== actor.tokenHash) return { count: 0 };
        if (where?.connectionId && where.connectionId !== (actor as any).connectionId) return { count: 0 };
        if (where?.botControlled !== undefined && where.botControlled !== (actor as any).botControlled) return { count: 0 };
        if (where?.connectedAt?.not === null && !(actor as any).connectedAt) return { count: 0 };
        Object.assign(actor, data);
        return { count: 1 };
      },
    },
    commandReceipt: { findUnique: async ({ where }: { where: { roomId_actionId: { actionId: string } } }) => receipts.get(where.roomId_actionId.actionId) ?? null },
    webSocketTicket: {
      create: async () => ({ id: "ticket-1" }),
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    playerMatchStat: { createMany: async ({ data }: { data: any[] }) => { data.forEach((row, index) => matchStats.set(`${row.roomId}:${row.participantId}:${index}`, row)); return { count: data.length }; } },
    $transaction: async (callback: (tx: any) => Promise<void>) => callback({
      gameRoom: adapter.gameRoom,
      participant: adapter.participant,
      webSocketTicket: adapter.webSocketTicket,
      playerMatchStat: adapter.playerMatchStat,
      userAccount: { findUnique: async () => null },
      gameEvent: { create: async ({ data }: { data: any }) => events.push({ id: `event-${events.length}`, ...data, createdAt: new Date() }) },
      commandReceipt: { create: async ({ data }: { data: any }) => {
        if (receipts.has(data.actionId)) { const error = new Error("duplicate"); (error as Error & { code?: string }).code = "P2002"; throw error; }
        receipts.set(data.actionId, data);
      } },
      gameResult: { upsert: async ({ create }: { create: any }) => { results.set(room.id, create); } },
    }),
  };
  return { adapter, room, participant: actor, receipts, results, matchStats };
}

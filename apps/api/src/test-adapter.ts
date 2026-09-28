import { createHash } from "node:crypto";
import { createGame } from "@abominations/game-engine";

/** Minimal persistence adapter shared by Prisma store contract tests. */
export function persistentAdapter() {
  const state = createGame(2);
  const room = { id: "room-1", code: "ABC123", status: "ACTIVE", privacy: "PUBLIC", maxPlayers: 2, version: 0, state, playerStats: [], isTest: false, lastActivityAt: new Date(), participants: [], events: [] };
  const actor: any = { id: "player-1", roomId: room.id, displayName: "Player 1", role: "PLAYER", playerIndex: 0, userId: null, tokenHash: createHash("sha256").update("token").digest("hex"), sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), connectedAt: new Date(), disconnectedAt: null, connectionId: null, botControlled: false, botAssisted: false, ready: false };
  const participants: any[] = [actor];
  const receipts = new Map<string, unknown>();
  const results = new Map<string, unknown>();
  const matchStats = new Map<string, unknown>();
  const events: any[] = [];
  const socketTickets = new Map<string, any>();
  const matchesParticipant = (candidate: any, criteria: any) => (!criteria.role || candidate.role === criteria.role)
    && (criteria.botControlled === undefined || candidate.botControlled === criteria.botControlled)
    && (criteria.userId?.not !== null || candidate.userId !== null && candidate.userId !== undefined);
  const matchesRoomFilter = (filter: any): boolean => {
    if (filter.OR && !filter.OR.some(matchesRoomFilter)) return false;
    if (filter.lastActivityAt?.gt && room.lastActivityAt.getTime() <= filter.lastActivityAt.gt.getTime()) return false;
    if (filter.participants?.some && !participants.some((candidate) => matchesParticipant(candidate, filter.participants.some))) return false;
    if (filter.participants?.none && participants.some((candidate) => matchesParticipant(candidate, filter.participants.none))) return false;
    return true;
  };
  const adapter: any = {
    $queryRaw: async () => [{ "?column?": 1 }],
    gameRoom: {
      findMany: async ({ where }: { where?: any } = {}) => {
        if (where?.status?.in && !where.status.in.includes(room.status)) return [];
        if (where?.participants?.some && !participants.some((candidate) => matchesParticipant(candidate, where.participants.some))) return [];
        return [{ ...room, participants: [...participants] }];
      },
      findUnique: async ({ include }: { include?: unknown }) => include ? { ...room, participants: [...participants], events: [...events].filter((event) => event.version > ((include as any).events?.where?.version?.gt ?? 0)).reverse().slice(0, (include as any).events?.take ?? 256) } : room,
      updateMany: async ({ where, data }: { where: { version?: number; status?: string }; data: any }) => {
        if (where.version !== undefined && where.version !== room.version) return { count: 0 };
        if (where.status !== undefined && where.status !== room.status) return { count: 0 };
        if (Object.hasOwn(where, "lastActivityAt")) {
          const activityFilter = (where as any).lastActivityAt;
          const expectedActivityAt = activityFilter instanceof Date ? activityFilter : activityFilter?.equals;
          if (expectedActivityAt?.getTime?.() !== room.lastActivityAt?.getTime?.()) return { count: 0 };
          if (activityFilter?.gt && room.lastActivityAt?.getTime?.() <= activityFilter.gt.getTime()) return { count: 0 };
        }
        const conditions = Array.isArray((where as any).AND) ? (where as any).AND : (where as any).AND ? [(where as any).AND] : [];
        if (conditions.some((condition: any) => !matchesRoomFilter(condition)) || !matchesRoomFilter(where)) return { count: 0 };
        Object.assign(room, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: any }) => { Object.assign(room, data); return room; },
    },
    participant: {
      findFirst: async ({ where, include }: { where?: any; include?: any } = {}) => {
        const criteria = where ?? {};
        if (criteria.roomId && criteria.roomId !== room.id) return null;
        const target = participants.find((candidate) => {
          if (criteria.tokenHash && criteria.tokenHash !== candidate.tokenHash) return false;
          if (criteria.id && criteria.id !== candidate.id) return false;
          if (Object.hasOwn(criteria, "userId") && (criteria.userId?.not === null ? candidate.userId === null || candidate.userId === undefined : criteria.userId !== candidate.userId)) return false;
          if (criteria.role && criteria.role !== candidate.role) return false;
          if (criteria.ready !== undefined && criteria.ready !== candidate.ready) return false;
          if (criteria.botControlled !== undefined && criteria.botControlled !== candidate.botControlled) return false;
          if (criteria.sessionExpiresAt?.gt && new Date(candidate.sessionExpiresAt).getTime() <= criteria.sessionExpiresAt.gt.getTime()) return false;
          if (Object.hasOwn(criteria, "connectionId") && criteria.connectionId !== candidate.connectionId) return false;
          if (criteria.connectedAt?.not === null && !candidate.connectedAt) return false;
          if (criteria.connectedAt === null && candidate.connectedAt) return false;
          if (criteria.connectedAt instanceof Date && candidate.connectedAt?.getTime?.() !== criteria.connectedAt.getTime()) return false;
          return true;
        });
        return target ? include?.room ? { ...target, room } : target : null;
      },
      count: async ({ where }: { where?: any } = {}) => participants.filter((candidate) => (!where?.roomId || candidate.roomId === where.roomId)
        && (!where?.role || candidate.role === where.role)
        && (where?.userId?.not === null ? candidate.userId !== null && candidate.userId !== undefined : !Object.hasOwn(where ?? {}, "userId") || where.userId === candidate.userId)).length,
      findMany: async ({ where }: { where?: any } = {}) => participants.filter((candidate) => (!where?.roomId || candidate.roomId === where.roomId)
        && (!where?.role || candidate.role === where.role)
        && (where?.connectedAt === undefined || candidate.connectedAt === where.connectedAt)
        && (where?.botControlled === undefined || candidate.botControlled === where.botControlled)
        && (!where?.disconnectedAt?.lte || new Date(candidate.disconnectedAt).getTime() <= where.disconnectedAt.lte.getTime())
        && (!where?.userId?.not || candidate.userId !== null && candidate.userId !== undefined)
        && (!where?.room?.status?.in || where.room.status.in.includes(room.status))),
      update: async ({ data }: { data: any }) => { Object.assign(actor, data); return actor; },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        const target = participants.find((candidate) => candidate.id === where?.id);
        if (!target || (where?.roomId && where.roomId !== room.id)) return { count: 0 };
        if (where && Object.hasOwn(where, "userId") && where.userId !== target.userId) return { count: 0 };
        if (where?.role && where.role !== target.role) return { count: 0 };
        if (where?.tokenHash && where.tokenHash !== target.tokenHash) return { count: 0 };
        if (where && Object.hasOwn(where, "connectionId") && where.connectionId !== target.connectionId) return { count: 0 };
        if (Array.isArray(where?.OR) && !where.OR.some((item: any) => Object.entries(item).every(([key, value]) => target[key] === value))) return { count: 0 };
        if (where?.ready !== undefined && where.ready !== target.ready) return { count: 0 };
        if (where?.botControlled !== undefined && where.botControlled !== target.botControlled) return { count: 0 };
        if (where?.sessionExpiresAt?.gt && new Date(target.sessionExpiresAt).getTime() <= where.sessionExpiresAt.gt.getTime()) return { count: 0 };
        if (where?.connectedAt?.not === null && !target.connectedAt) return { count: 0 };
        if (where?.connectedAt === null && target.connectedAt) return { count: 0 };
        if (where?.connectedAt instanceof Date && target.connectedAt?.getTime?.() !== where.connectedAt.getTime()) return { count: 0 };
        if (where?.disconnectedAt instanceof Date && target.disconnectedAt?.getTime?.() !== where.disconnectedAt.getTime()) return { count: 0 };
        if (where?.disconnectedAt?.lte && new Date(target.disconnectedAt).getTime() > where.disconnectedAt.lte.getTime()) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
    },
    commandReceipt: { findUnique: async ({ where }: { where: { roomId_actionId: { actionId: string } } }) => receipts.get(where.roomId_actionId.actionId) ?? null },
    webSocketTicket: {
      create: async ({ data }: { data: any }) => {
        const ticket = { id: `ticket-${socketTickets.size + 1}`, consumedAt: null, ...data };
        socketTickets.set(ticket.id, ticket);
        return ticket;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const ticket = [...socketTickets.values()].find((candidate) => candidate.tokenHash === where.tokenHash);
        return ticket ? { ...ticket, room, participant: actor } : null;
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        const ticket = socketTickets.get(where.id);
        if (!ticket || (where.consumedAt === null && ticket.consumedAt !== null)) return { count: 0 };
        Object.assign(ticket, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: any }) => {
        let count = 0;
        for (const [id, ticket] of socketTickets) {
          if (where.participantId && ticket.participantId !== where.participantId) continue;
          if (where.consumedAt === null && ticket.consumedAt !== null) continue;
          socketTickets.delete(id);
          count += 1;
        }
        return { count };
      },
    },
    playerMatchStat: { createMany: async ({ data }: { data: any[] }) => { data.forEach((row, index) => matchStats.set(`${row.roomId}:${row.participantId}:${index}`, row)); return { count: data.length }; } },
    $transaction: async (callback: (tx: any) => Promise<void>) => callback({
      gameRoom: adapter.gameRoom,
      participant: adapter.participant,
      webSocketTicket: adapter.webSocketTicket,
      playerMatchStat: adapter.playerMatchStat,
      userAccount: { findUnique: async () => null },
      gameEvent: {
        findFirst: async ({ where, orderBy }: { where?: any; orderBy?: any }) => {
          const matching = events.filter((event) => (!where?.roomId || event.roomId === where.roomId)
            && (!where?.type || event.type === where.type)
            && (where?.version?.gt === undefined || event.version > where.version.gt));
          matching.sort((left, right) => orderBy?.version === "desc" ? right.version - left.version : left.version - right.version);
          return matching[0] ?? null;
        },
        create: async ({ data }: { data: any }) => events.push({ id: `event-${events.length}`, ...data, createdAt: new Date() }),
      },
      commandReceipt: { create: async ({ data }: { data: any }) => {
        if (receipts.has(data.actionId)) { const error = new Error("duplicate"); (error as Error & { code?: string }).code = "P2002"; throw error; }
        receipts.set(data.actionId, data);
      } },
      gameResult: { upsert: async ({ create }: { create: any }) => { results.set(room.id, create); } },
    }),
  };
  return { adapter, room, participant: actor, participants, receipts, results, matchStats, events, socketTickets };
}

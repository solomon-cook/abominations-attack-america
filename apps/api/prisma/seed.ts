import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { createGame } from "@abominations/game-engine";

const databaseUrl = process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed Prisma.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main() {
  const room = await prisma.gameRoom.upsert({
    where: { code: "SEED01" },
    update: { status: "WAITING", maxPlayers: 4, state: createGame(2) as any },
    create: { code: "SEED01", status: "WAITING", maxPlayers: 4, state: createGame(2) as any }
  });

  await prisma.participant.upsert({
    where: { tokenHash: "seed-player-1" },
    update: { roomId: room.id, displayName: "Seed Player", role: "PLAYER", playerIndex: 0 },
    create: { roomId: room.id, displayName: "Seed Player", role: "PLAYER", playerIndex: 0, tokenHash: "seed-player-1" }
  });

  await prisma.participant.upsert({
    where: { tokenHash: "seed-spectator-1" },
    update: { roomId: room.id, displayName: "Seed Spectator", role: "SPECTATOR", playerIndex: null },
    create: { roomId: room.id, displayName: "Seed Spectator", role: "SPECTATOR", tokenHash: "seed-spectator-1" }
  });

  console.log("Seeded SEED01 with a player and spectator.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

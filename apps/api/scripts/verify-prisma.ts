import { prisma } from "../lib/prisma.js";

try {
  const roomCount = await prisma.gameRoom.count();
  console.log(`✅ Connected (${roomCount} game rooms found)`);
} finally {
  await prisma.$disconnect();
}

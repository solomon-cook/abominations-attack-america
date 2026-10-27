import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const createPrismaClient = (url: string) => url.startsWith("prisma+")
  ? new PrismaClient({ accelerateUrl: url })
  : new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

export const prisma = databaseUrl
  ? globalForPrisma.prisma ?? createPrismaClient(databaseUrl)
  : undefined;

if (prisma) globalForPrisma.prisma = prisma;

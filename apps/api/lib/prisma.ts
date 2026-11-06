import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { observePoolLifecycle, type PoolLifecycleCounts } from "../src/pool-diagnostics.js";

const databaseUrl = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let pgPool: Pool | undefined;
let poolLifecycleSnapshot: (() => PoolLifecycleCounts) | undefined;

const createPrismaClient = (url: string) => {
  if (url.startsWith("prisma+")) return new PrismaClient({ accelerateUrl: url });

  const pool = new Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 20_000,
  });
  pgPool = pool;
  poolLifecycleSnapshot = observePoolLifecycle(pool);
  pool.on("error", (error: Error & { code?: string }) => {
    console.error("Idle PostgreSQL pool client error", error.code ?? error.name);
  });
  attachDatabasePool(pool);

  return new PrismaClient({ adapter: new PrismaPg(pool) });
};

export const prisma = databaseUrl
  ? globalForPrisma.prisma ?? createPrismaClient(databaseUrl)
  : undefined;

/** Safe per-function diagnostics for pool saturation; contains no connection details. */
export const databasePoolDiagnostics = () => pgPool ? {
  total: pgPool.totalCount,
  idle: pgPool.idleCount,
  waiting: pgPool.waitingCount,
  ...poolLifecycleSnapshot?.(),
} : undefined;

if (prisma) globalForPrisma.prisma = prisma;

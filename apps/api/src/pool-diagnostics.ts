import type { Pool } from "pg";

export interface PoolLifecycleCounts {
  clientsCreated: number;
  clientsAcquired: number;
  clientsReleased: number;
  clientsRemoved: number;
  idleClientErrors: number;
  idleClientErrorsByCode: Record<string, number>;
}

/** Tracks only connection lifecycle counts; never inspects URLs, query text, or error messages. */
export function observePoolLifecycle(pool: Pool): () => PoolLifecycleCounts {
  const counts: PoolLifecycleCounts = {
    clientsCreated: 0,
    clientsAcquired: 0,
    clientsReleased: 0,
    clientsRemoved: 0,
    idleClientErrors: 0,
    idleClientErrorsByCode: {},
  };
  pool.on("connect", () => { counts.clientsCreated += 1; });
  pool.on("acquire", () => { counts.clientsAcquired += 1; });
  pool.on("release", () => { counts.clientsReleased += 1; });
  pool.on("remove", () => { counts.clientsRemoved += 1; });
  pool.on("error", (error: Error & { code?: unknown }) => {
    counts.idleClientErrors += 1;
    const code = typeof error.code === "string" && (/^[0-9A-Z]{5}$/.test(error.code) || /^E[A-Z0-9]{3,16}$/.test(error.code))
      ? error.code
      : "unknown";
    counts.idleClientErrorsByCode[code] = (counts.idleClientErrorsByCode[code] ?? 0) + 1;
  });
  return () => ({ ...counts, idleClientErrorsByCode: { ...counts.idleClientErrorsByCode } });
}

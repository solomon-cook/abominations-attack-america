import type { Pool } from "pg";

export interface PoolLifecycleCounts {
  clientsCreated: number;
  clientsAcquired: number;
  clientsReleased: number;
  clientsRemoved: number;
  idleClientErrors: number;
}

/** Tracks only connection lifecycle counts; never inspects URLs, query text, or error messages. */
export function observePoolLifecycle(pool: Pool): () => PoolLifecycleCounts {
  const counts: PoolLifecycleCounts = {
    clientsCreated: 0,
    clientsAcquired: 0,
    clientsReleased: 0,
    clientsRemoved: 0,
    idleClientErrors: 0,
  };
  pool.on("connect", () => { counts.clientsCreated += 1; });
  pool.on("acquire", () => { counts.clientsAcquired += 1; });
  pool.on("release", () => { counts.clientsReleased += 1; });
  pool.on("remove", () => { counts.clientsRemoved += 1; });
  pool.on("error", () => { counts.idleClientErrors += 1; });
  return () => ({ ...counts });
}

export function resolveAllowedOrigin(nodeEnvironment = process.env.NODE_ENV, configuredOrigin = process.env.ALLOWED_ORIGIN): string {
  const origin = configuredOrigin?.trim() ?? "";
  if (nodeEnvironment !== "production") return origin || "*";
  if (!origin || origin === "*") throw new Error("ALLOWED_ORIGIN must be an explicit HTTPS origin in production.");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("ALLOWED_ORIGIN must be an explicit HTTPS origin in production.");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("ALLOWED_ORIGIN must be an explicit HTTPS origin in production.");
  }
  return origin;
}

export function resolveErrorAlertUrl(configuredUrl?: string): string | undefined {
  const endpoint = configuredUrl?.trim();
  if (!endpoint) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("ERROR_ALERT_URL must be an HTTPS URL without embedded credentials.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error("ERROR_ALERT_URL must be an HTTPS URL without embedded credentials.");
  }
  return endpoint;
}

export function resolveDatabaseConnections(environment: NodeJS.ProcessEnv = process.env): {
  databaseUrl?: string;
  directUrl?: string;
  roomNotificationsUrl?: string;
} {
  const databaseUrl = environment.DATABASE_URL_POOLED ?? environment.DATABASE_URL ?? environment.PRISMA_DATABASE_URL ?? environment.POSTGRES_URL;
  const directUrl = environment.DIRECT_URL?.trim() || undefined;
  return {
    ...(databaseUrl?.trim() ? { databaseUrl: databaseUrl.trim() } : {}),
    ...(directUrl ? { directUrl } : {}),
    ...(databaseUrl?.trim() ? { roomNotificationsUrl: directUrl ?? databaseUrl.trim() } : {}),
  };
}

export function validateRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): { nodeEnvironment: string; allowedOrigin: string; persistence: "memory" | "prisma"; errorAlertUrl?: string } {
  const nodeEnvironment = environment.NODE_ENV ?? "development";
  const allowedOrigin = resolveAllowedOrigin(nodeEnvironment, environment.ALLOWED_ORIGIN);
  const errorAlertUrl = resolveErrorAlertUrl(environment.ERROR_ALERT_URL);
  const { databaseUrl, directUrl } = resolveDatabaseConnections(environment);
  if (nodeEnvironment === "production" && !databaseUrl?.trim()) {
    throw new Error("A production API requires DATABASE_URL_POOLED, DATABASE_URL, PRISMA_DATABASE_URL, or POSTGRES_URL.");
  }
  if (nodeEnvironment === "production" && databaseUrl) {
    for (const configuredUrl of [databaseUrl, directUrl].filter((value): value is string => Boolean(value))) {
      let hostname: string;
      try {
        hostname = new URL(configuredUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      } catch {
        throw new Error("A production API requires valid database URLs.");
      }
      if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
        throw new Error("A production API cannot use a loopback database URL.");
      }
    }
    if (new URL(databaseUrl).hostname.toLowerCase() === "pooled.db.prisma.io" && !directUrl) {
      throw new Error("Prisma Postgres pooled runtime requires DIRECT_URL for migrations and room notifications.");
    }
  }
  return { nodeEnvironment, allowedOrigin, persistence: databaseUrl ? "prisma" : "memory", ...(errorAlertUrl ? { errorAlertUrl } : {}) };
}

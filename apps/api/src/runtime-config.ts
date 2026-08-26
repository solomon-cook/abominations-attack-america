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

export function validateRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): { nodeEnvironment: string; allowedOrigin: string; persistence: "memory" | "prisma" } {
  const nodeEnvironment = environment.NODE_ENV ?? "development";
  const allowedOrigin = resolveAllowedOrigin(nodeEnvironment, environment.ALLOWED_ORIGIN);
  const databaseUrl = environment.DATABASE_URL ?? environment.PRISMA_DATABASE_URL ?? environment.POSTGRES_URL;
  if (nodeEnvironment === "production" && !databaseUrl?.trim()) {
    throw new Error("A production API requires DATABASE_URL, PRISMA_DATABASE_URL, or POSTGRES_URL.");
  }
  if (nodeEnvironment === "production" && databaseUrl) {
    try {
      const hostname = new URL(databaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("loopback");
    } catch (error) {
      if (error instanceof Error && error.message === "loopback") throw new Error("A production API cannot use a loopback database URL.");
      throw new Error("A production API requires a valid database URL.");
    }
  }
  return { nodeEnvironment, allowedOrigin, persistence: databaseUrl ? "prisma" : "memory" };
}

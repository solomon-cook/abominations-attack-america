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

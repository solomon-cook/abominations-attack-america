/** Normalize a configured API base or use the environment-specific origin supplied by the caller. */
export function resolveApiBaseUrl(configured: string | undefined, environmentOrigin: string): string {
  const value = configured?.trim();
  return value ? value.replace(/\/+$/, "") : environmentOrigin.replace(/\/+$/, "");
}

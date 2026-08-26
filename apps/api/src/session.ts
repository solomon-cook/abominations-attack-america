export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function sessionExpiresAt(now = Date.now()): Date {
  return new Date(now + SESSION_TTL_MS);
}

export function isSessionExpired(expiresAt: Date | number, now = Date.now()): boolean {
  const timestamp = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
  return timestamp <= now;
}

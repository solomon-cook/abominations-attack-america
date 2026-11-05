type ApiError = Error & { status?: unknown; code?: unknown };

const safeIdentifier = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;

export function classifyApiError(error: unknown) {
  const candidate = error as ApiError | undefined;
  const message = error instanceof Error ? error.message : "Request failed";
  const code = safeIdentifier(candidate?.code);
  const status = Number(candidate?.status);
  const databaseTimeout = message === "Query read timeout"
    || message === "Connection terminated due to connection timeout"
    || code === "ETIMEDOUT"
    || code === "ECONNRESET"
    || code === "ECONNREFUSED";

  if (databaseTimeout) {
    return {
      status: 503,
      message: "The game service is temporarily unavailable. Please try again.",
      category: "database-timeout",
      errorName: safeIdentifier(candidate?.name) ?? "DatabaseError",
      errorCode: code,
    };
  }

  const validStatus = Number.isInteger(status) && status >= 400 && status <= 599;
  return {
    status: validStatus ? status : 400,
    message,
    category: "request",
    errorName: safeIdentifier(candidate?.name) ?? "Error",
    errorCode: code,
  };
}

import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitBuckets = new Map<string, { windowStartedAt: number; count: number }>();

function allowRequest(request: IncomingMessage, now = Date.now()) {
  const realIp = request.headers["x-real-ip"];
  const forwarded = request.headers["x-forwarded-for"];
  const address = (typeof realIp === "string" ? realIp : undefined)
    ?? (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined)
    ?? request.socket.remoteAddress
    ?? "unknown";
  let bucket = rateLimitBuckets.get(address);
  if (!bucket || now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS || now < bucket.windowStartedAt) {
    bucket = { windowStartedAt: now, count: 0 };
    rateLimitBuckets.set(address, bucket);
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) return Math.max(1, Math.ceil((bucket.windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1000));
  bucket.count += 1;
  if (rateLimitBuckets.size > 5_000) {
    for (const [key, value] of rateLimitBuckets) {
      if (now - value.windowStartedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(key);
    }
    while (rateLimitBuckets.size > 5_000) {
      const oldest = rateLimitBuckets.keys().next().value as string | undefined;
      if (!oldest) break;
      rateLimitBuckets.delete(oldest);
    }
  }
  return 0;
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function reply(response: ServerResponse, status: number, payload: string, headers: Headers = new Headers()) {
  const forwarded: Record<string, string | string[]> = {
    "cache-control": headers.get("cache-control") ?? "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
  const contentType = headers.get("content-type");
  if (contentType) forwarded["content-type"] = contentType;
  const retryAfter = headers.get("retry-after");
  if (retryAfter) forwarded["retry-after"] = retryAfter;
  const cookies = headers.getSetCookie();
  if (cookies.length) forwarded["set-cookie"] = cookies;
  response.writeHead(status, forwarded);
  response.end(payload);
}

export default async function convexProxy(request: IncomingMessage, response: ServerResponse) {
  const retryAfter = allowRequest(request);
  if (retryAfter) return reply(response, 429, JSON.stringify({ error: "Too many requests. Try again shortly." }), new Headers({ "content-type": "application/json; charset=utf-8", "retry-after": String(retryAfter) }));
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) return reply(response, 503, JSON.stringify({ error: "Convex HTTP endpoint is not configured." }), new Headers({ "content-type": "application/json; charset=utf-8" }));
  const base = new URL(siteUrl);
  const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
  const queryPath = (request as IncomingMessage & { query?: { path?: string | string[] } }).query?.path;
  const routePath = (Array.isArray(queryPath) ? queryPath.join("/") : queryPath) ?? url.pathname.replace(/^\/api\/?/, "");
  const target = new URL(`${routePath}${url.search}`, `${base.origin}/`);
  const headers = new Headers();
  for (const name of ["content-type", "cookie", "origin", "x-room-token", "user-agent", "x-forwarded-for", "x-real-ip"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  try {
    const hasBody = !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET");
    const body = hasBody ? await readBody(request) : undefined;
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body ? { body, duplex: "half" as const } : {}),
      redirect: "manual",
    });
    const payload = upstream.status === 204 ? "" : Buffer.from(await upstream.arrayBuffer()).toString("utf8");
    reply(response, upstream.status, payload, upstream.headers);
  } catch (error) {
    const status = Number((error as { status?: number }).status ?? 502);
    reply(response, status, JSON.stringify({ error: error instanceof Error ? error.message : "Convex request failed." }), new Headers({ "content-type": "application/json; charset=utf-8" }));
  }
}

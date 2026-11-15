import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;

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
  const cookies = headers.getSetCookie();
  if (cookies.length) forwarded["set-cookie"] = cookies;
  response.writeHead(status, forwarded);
  response.end(payload);
}

export default async function convexProxy(request: IncomingMessage, response: ServerResponse) {
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

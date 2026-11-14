import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import convexProxy from "./convex-proxy.js";

test("same-origin proxy forwards API paths, JSON bodies, cookies, and upstream session cookies", async (t) => {
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("set-cookie", ["aaa_account=rotated; Path=/; HttpOnly; SameSite=Lax", "preference=dark; Path=/; SameSite=Lax"]);
    response.end(JSON.stringify({ path: request.url, cookie: request.headers.cookie, forwardedFor: request.headers["x-forwarded-for"], body: Buffer.concat(chunks).toString("utf8") }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const previousSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = `http://127.0.0.1:${upstreamPort}`;
  const gateway = createServer(convexProxy);
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const gatewayPort = (gateway.address() as { port: number }).port;
  t.after(async () => {
    await Promise.all([new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())), new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()))]);
    if (previousSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousSiteUrl;
  });

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/accounts/login?source=web`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "aaa_account=prior", origin: "https://game.example", "x-forwarded-for": "203.0.113.44" },
    body: JSON.stringify({ email: "player@example.com" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: "/accounts/login?source=web", cookie: "aaa_account=prior", forwardedFor: "203.0.113.44", body: JSON.stringify({ email: "player@example.com" }) });
  assert.ok(response.headers.get("set-cookie")?.includes("aaa_account=rotated"));
  assert.ok(response.headers.get("set-cookie")?.includes("preference=dark"));
});

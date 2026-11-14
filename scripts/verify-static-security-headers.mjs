import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configurationPath = new URL("../vercel.json", import.meta.url);
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const wildcardRule = configuration.headers?.find((rule) => rule.source === "/(.*)");
assert.ok(wildcardRule, "Vercel must apply the static security policy to every response path.");

const responseHeaders = new Map(wildcardRule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
const expected = new Map([
  ["strict-transport-security", "max-age=31536000; includeSubDomains"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "no-referrer"],
  ["permissions-policy", "camera=(), geolocation=(), microphone=()"],
]);
for (const [name, value] of expected) assert.equal(responseHeaders.get(name), value, `${name} must match the reviewed static-site policy.`);

const csp = responseHeaders.get("content-security-policy");
assert.ok(csp, "Static responses must carry an enforcing Content-Security-Policy.");
for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
  assert.ok(csp.split(";").some((part) => part.trim() === directive), `CSP must include ${directive}.`);
}
assert.ok(!/(?:^|\s)'unsafe-(?:eval|inline)'(?:\s|$)/.test(csp.match(/script-src[^;]*/)?.[0] ?? ""), "CSP script-src must not permit inline or evaluated scripts.");
const connectSource = csp.split(";").find((part) => part.trim().startsWith("connect-src "))?.trim();
assert.equal(
  connectSource,
  "connect-src 'self' https://*.convex.cloud https://*.convex.site ws: wss:",
  "CSP must allow same-origin, Convex HTTPS, and WebSocket transports only.",
);

console.log("Vercel static responses apply the reviewed CSP and baseline transport, framing, MIME, referrer, and permissions headers.");

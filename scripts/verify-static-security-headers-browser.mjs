import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dist = resolve("apps/web/dist");
const configuration = JSON.parse(await readFile("vercel.json", "utf8"));
const headers = Object.fromEntries(configuration.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json"],
  [".webmanifest", "application/manifest+json"],
]);

await stat(join(dist, "index.html")).catch(() => {
  throw new Error("Build the web app before running security:headers:browser:verify.");
});

const server = createServer(async (request, response) => {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = pathname === "/" ? join(dist, "index.html") : resolve(dist, `.${pathname}`);
  if (!file.startsWith(`${dist}${sep}`)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const details = await stat(file);
    if (!details.isFile()) throw new Error("Not a file.");
    response.setHeader("content-type", contentTypes.get(extname(file)) ?? "application/octet-stream");
    response.writeHead(200).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address !== "string", "The local static security server must bind a TCP port.");

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  const policyErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|refused to (load|connect)/i.test(message.text())) policyErrors.push(message.text());
  });
  const response = await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, "The built web app must load under the static policy.");
  const responseHeaders = response.headers();
  for (const name of ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
    assert.ok(responseHeaders[name], `The local static policy must serve ${name} on the app document.`);
  }
  await page.waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0);
  assert.ok((await page.locator("#root").innerText()).trim(), "The app must render content while the enforcing CSP is active.");
  assert.deepEqual(policyErrors, [], "The built app must not violate its static response policy.");
  console.log("The production web build renders in Chrome with the configured security headers and no CSP violations.");
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

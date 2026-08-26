import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../apps/web/public/manifest.webmanifest", import.meta.url), "utf8"));
const html = await readFile(new URL("../apps/web/index.html", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../apps/web/public/sw.js", import.meta.url), "utf8");
const offline = await readFile(new URL("../apps/web/public/offline.html", import.meta.url), "utf8");
const icon = await readFile(new URL("../apps/web/public/pwa-icon.svg", import.meta.url), "utf8");
const main = await readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

assert.equal(manifest.display, "standalone");
assert.equal(manifest.orientation, "landscape");
assert.equal(manifest.start_url, "/");
assert.ok(manifest.icons.some((entry) => entry.src === "/pwa-icon.svg"));
assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(html, /name="theme-color"/);
assert.match(serviceWorker, /offline\.html/);
assert.match(serviceWorker, /CACHE_NAME/);
assert.match(serviceWorker, /SKIP_WAITING/);
assert.match(offline, /authoritative rooms and actions require a live connection/);
assert.match(icon, /<svg/);
assert.match(main, /New version available/);
assert.match(main, /activatePwaUpdate/);
console.log("Verified installable PWA manifest, icon, offline fallback, and cache worker boundary.");

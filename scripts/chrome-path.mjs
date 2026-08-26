import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

const defaultCandidates = [
  process.env.CHROME_PATH,
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
  process.platform === "darwin" ? `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome-stable" : undefined,
  process.platform === "linux" ? "/usr/bin/chromium" : undefined,
  process.platform === "linux" ? "/usr/bin/chromium-browser" : undefined,
  process.platform === "linux" ? "/usr/bin/microsoft-edge" : undefined,
  process.platform === "linux" ? "/usr/bin/microsoft-edge-stable" : undefined,
  process.platform === "linux" ? "/usr/bin/msedge" : undefined,
  process.platform === "win32" ? `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  process.platform === "win32" ? `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
].filter(Boolean);
const requestedCandidates = [
  process.env.BROWSER_BINARY,
  process.env.EDGE_PATH,
  process.platform === "linux" ? "/usr/bin/microsoft-edge" : undefined,
  process.platform === "linux" ? "/usr/bin/microsoft-edge-stable" : undefined,
  process.platform === "linux" ? "/usr/bin/msedge" : undefined,
].filter(Boolean);
const candidates = process.env.BROWSER_BINARY ? requestedCandidates : defaultCandidates;

let resolvedChromePath;
for (const candidate of candidates) {
  try {
    accessSync(candidate, constants.X_OK);
    console.error(`Using Chrome executable: ${candidate}`);
    resolvedChromePath = candidate;
    break;
  } catch {
    // Continue through the platform-specific candidates.
  }
}

if (!resolvedChromePath) {
  const commands = process.env.BROWSER_BINARY
    ? [process.env.BROWSER_BINARY]
    : process.platform === "win32"
      ? ["chrome.exe", "chromium.exe", "msedge.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "msedge"];
  for (const command of commands) {
    try {
      const resolved = execFileSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" }).trim().split("\n")[0];
      if (resolved) {
        console.error(`Using Chrome executable from PATH: ${resolved}`);
        resolvedChromePath = resolved;
        break;
      }
    } catch {
      // Try the next command.
    }
  }
}

if (!resolvedChromePath && process.env.BROWSER_BINARY) {
  throw new Error(`Requested browser binary not found: ${process.env.BROWSER_BINARY}`);
}
if (!resolvedChromePath) throw new Error("Chrome executable not found. Set CHROME_PATH or install Google Chrome/Chromium before running browser verification.");

export const chromePath = resolvedChromePath;

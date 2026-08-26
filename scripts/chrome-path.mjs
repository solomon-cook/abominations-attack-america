import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

const candidates = [
  process.env.CHROME_PATH,
  process.env.BROWSER_BINARY,
  process.env.EDGE_PATH,
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
  process.platform === "darwin" ? `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome-stable" : undefined,
  process.platform === "linux" ? "/usr/bin/chromium" : undefined,
  process.platform === "linux" ? "/usr/bin/chromium-browser" : undefined,
  process.platform === "win32" ? `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  process.platform === "win32" ? `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
].filter(Boolean);

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
  const commands = process.platform === "win32"
    ? [process.env.BROWSER_BINARY, "chrome.exe", "chromium.exe", "msedge.exe"].filter(Boolean)
    : [process.env.BROWSER_BINARY, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "msedge"].filter(Boolean);
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

if (!resolvedChromePath) throw new Error("Chrome executable not found. Set CHROME_PATH or install Google Chrome/Chromium before running browser verification.");

export const chromePath = resolvedChromePath;

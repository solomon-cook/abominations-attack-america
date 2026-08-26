import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const cases = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];
const baselinePath = join(process.cwd(), "docs/browser-visual-baselines.json");
const tempDirectory = await mkdtemp(join(tmpdir(), "abominations-visual-regression-"));

function runCase(testCase, screenshotPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-browser-local.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER_TEST_WIDTH: String(testCase.width), BROWSER_TEST_HEIGHT: String(testCase.height), BROWSER_TEST_SCREENSHOT_PATH: screenshotPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${testCase.name} visual smoke failed (code ${code ?? "none"}, signal ${signal ?? "none"})\n${stdout}${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const observed = {};
try {
  for (const testCase of cases) {
    const screenshotPath = join(tempDirectory, `${testCase.name}.png`);
    const output = await runCase(testCase, screenshotPath);
    const image = await readFile(screenshotPath);
    observed[testCase.name] = {
      width: testCase.width,
      height: testCase.height,
      sha256: createHash("sha256").update(image).digest("hex"),
      smoke: JSON.parse(output),
    };
  }

  if (process.env.UPDATE_BROWSER_VISUAL_BASELINES === "1") {
    await writeFile(baselinePath, `${JSON.stringify(observed, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, updated: baselinePath, cases: Object.keys(observed) }));
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const mismatches = cases.flatMap(({ name }) => {
      const expected = baseline[name];
      const actual = observed[name];
      if (expected?.width === actual.width && expected?.height === actual.height && expected?.sha256 === actual.sha256) return [];
      return [{ name, expected: { width: expected?.width, height: expected?.height, sha256: expected?.sha256 }, actual: { width: actual.width, height: actual.height, sha256: actual.sha256 } }];
    });
    if (mismatches.length) throw new Error(`Browser visual regression mismatch: ${JSON.stringify(mismatches)}`);
    console.log(JSON.stringify({ ok: true, baseline: baselinePath, cases: Object.keys(observed), evidence: "Chrome PNG hash at post-setup checkpoint" }));
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

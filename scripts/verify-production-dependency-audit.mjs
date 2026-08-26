import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const baseline = JSON.parse(await readFile(new URL("../config/production-audit-baseline.json", import.meta.url), "utf8"));
const result = await new Promise((resolve, reject) => {
  const child = spawn("npm", ["audit", "--omit=dev", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, stdout, stderr }));
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error(`npm audit did not return JSON (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
}

const vulnerabilities = Object.values(report.vulnerabilities ?? {}).map((advisory) => ({
  name: advisory.name,
  severity: advisory.severity,
  range: advisory.range,
  via: advisory.via?.filter((entry) => typeof entry === "string" || entry.title).map((entry) => typeof entry === "string" ? entry : entry.title) ?? [],
}));
const expected = baseline.knownProductionAdvisories.map((advisory) => ({ ...advisory, via: [advisory.via] }));
const same = (left, right) => left.name === right.name && left.severity === right.severity && left.range === right.range && left.via.length === right.via.length && left.via.every((entry) => right.via.includes(entry));
const unexpected = vulnerabilities.filter((advisory) => !expected.some((known) => same(advisory, known)));
const missing = expected.filter((known) => !vulnerabilities.some((advisory) => same(known, advisory)));

if (unexpected.length || missing.length) {
  throw new Error(`Production dependency audit baseline drifted. Unexpected: ${JSON.stringify(unexpected)}. Missing: ${JSON.stringify(missing)}.`);
}

console.log(JSON.stringify({
  ok: true,
  auditExit: result.code,
  productionVulnerabilities: vulnerabilities.length,
  knownBlockers: expected.map(({ name, severity, via }) => ({ name, severity, via })),
  status: "known-baseline-only; remediation remains a release blocker",
}));

import { spawnSync } from "node:child_process";

if (!["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) {
  console.log("Skipping database migrations outside a Vercel Preview or Production deployment.");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "preview") {
  const previewDatabaseUrl = process.env.PREVIEW_DATABASE_URL_POOLED?.trim() || process.env.PREVIEW_DATABASE_URL?.trim();
  const previewDirectUrl = process.env.PREVIEW_DIRECT_URL?.trim();
  if (!previewDatabaseUrl || !previewDirectUrl) {
    throw new Error("Vercel Preview migrations require isolated PREVIEW_DATABASE_URL(_POOLED) and PREVIEW_DIRECT_URL connections.");
  }
  process.env.DATABASE_URL = previewDatabaseUrl;
  process.env.DIRECT_URL = previewDirectUrl;
  delete process.env.DATABASE_URL_POOLED;
} else if (!process.env.DIRECT_URL?.trim()) {
  throw new Error("Vercel Production deployments require the server-side DIRECT_URL to apply Prisma migrations.");
}

const migration = spawnSync("npm", ["run", "prisma:migrate:deploy"], { stdio: "inherit" });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

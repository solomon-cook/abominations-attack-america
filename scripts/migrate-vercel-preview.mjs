import { spawnSync } from "node:child_process";

if (!["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) {
  console.log("Skipping database migrations outside a Vercel Preview or Production deployment.");
  process.exit(0);
}

if (!process.env.DIRECT_URL?.trim()) {
  throw new Error(`Vercel ${process.env.VERCEL_ENV} deployments require the server-side DIRECT_URL to apply Prisma migrations.`);
}

const migration = spawnSync("npm", ["run", "prisma:migrate:deploy"], { stdio: "inherit" });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

import { build } from "esbuild";

await build({
  entryPoints: ["apps/api/src/vercel-handler.ts"],
  outfile: "apps/api/dist/vercel-handler.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Keep Prisma and Node-oriented packages native to avoid rewriting Prisma's
  // CommonJS runtime into an ESM require shim. Bundle private workspace source
  // packages because Node cannot resolve their exported TypeScript at runtime.
  external: ["@prisma/client", "@prisma/adapter-pg", "dotenv", "dotenv/*", "pg", "pg/*", "ws"],
  sourcemap: false,
  minify: false,
});

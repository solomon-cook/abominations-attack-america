import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const gameBackend = env.VITE_GAME_BACKEND;
  const convexUrl = env.VITE_CONVEX_URL ?? (mode === "development" ? env.CONVEX_URL : undefined);
  const siteUrl = env.VITE_CONVEX_SITE_URL ?? (mode === "development" ? env.CONVEX_SITE_URL : undefined);
  if (gameBackend && gameBackend !== "convex" && gameBackend !== "prisma") {
    throw new Error("VITE_GAME_BACKEND must be either convex or prisma.");
  }
  if (gameBackend === "convex" && !convexUrl) {
    throw new Error("VITE_GAME_BACKEND is convex, but VITE_CONVEX_URL is not configured.");
  }
  if (process.env.VERCEL_ENV === "preview" && (convexUrl || siteUrl)) {
    throw new Error("Vercel Preview builds must not include Convex URLs; use the Prisma WebSocket backend to avoid preview Convex usage.");
  }
  if (process.env.VERCEL_ENV === "preview" && env.VITE_ENABLE_WEBSOCKETS === "false") {
    throw new Error("Vercel Preview builds must keep WebSockets enabled instead of falling back to database polling.");
  }
  return {
    envDir: repositoryRoot,
    plugins: [{
      name: "convex-client-environment",
      transform(source, id) {
        if (id.split("?")[0] !== resolve(webRoot, "src/api.ts")) return;
        return source
          .replaceAll("__APP_CONVEX_URL__", JSON.stringify(convexUrl ?? ""))
          .replaceAll("__APP_CONVEX_SITE_URL__", JSON.stringify(siteUrl ?? ""));
      },
    }],
    server: siteUrl ? {
      proxy: {
        "/api": {
          target: siteUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    } : undefined,
  };
});

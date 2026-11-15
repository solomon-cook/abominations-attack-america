import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const convexUrl = env.VITE_CONVEX_URL ?? (mode === "development" ? env.CONVEX_URL : undefined);
  const siteUrl = env.VITE_CONVEX_SITE_URL ?? (mode === "development" ? env.CONVEX_SITE_URL : undefined);
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

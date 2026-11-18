/// <reference types="vite/client" />

declare const __APP_CONVEX_URL__: string;
declare const __APP_CONVEX_SITE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ENABLE_WEBSOCKETS?: string;
  readonly VITE_GAME_BACKEND?: "convex" | "prisma";
  readonly VITE_ROOM_POLL_INTERVAL_MS?: string;
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CONVEX_SITE_URL?: string;
}

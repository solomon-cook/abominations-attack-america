// The non-Convex web build sends room and account traffic to this Prisma API.
// Exporting the Node server lets Vercel handle both HTTP requests and WebSocket
// upgrades on the same route while keeping `/api/*` available for Convex builds.
export { default } from "../../apps/api/dist/server.mjs";

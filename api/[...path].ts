import type { IncomingMessage, ServerResponse } from "node:http";

type ApiHandler = typeof import("../apps/api/src/vercel-handler.js").default;
let handlerPromise: Promise<ApiHandler> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  // @ts-expect-error The build step emits this ESM bundle before Vercel traces the function.
  handlerPromise ??= import("../apps/api/dist/vercel-handler.mjs").then((module) => module.default as ApiHandler);
  return (await handlerPromise)(request, response);
}

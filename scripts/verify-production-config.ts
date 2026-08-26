import { validateRuntimeConfig } from "../apps/api/src/runtime-config.js";

const config = validateRuntimeConfig();
if (config.nodeEnvironment === "production" && config.persistence !== "prisma") {
  throw new Error("Production configuration did not select Prisma persistence.");
}

console.log(`Runtime configuration is valid for ${config.nodeEnvironment} (${config.persistence} persistence, origin ${config.allowedOrigin}).`);

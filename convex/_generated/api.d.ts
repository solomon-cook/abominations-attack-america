/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountAuth from "../accountAuth.js";
import type * as accountData from "../accountData.js";
import type * as accounts from "../accounts.js";
import type * as crons from "../crons.js";
import type * as errorReports from "../errorReports.js";
import type * as http from "../http.js";
import type * as replays from "../replays.js";
import type * as requestLimits from "../requestLimits.js";
import type * as rooms from "../rooms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountAuth: typeof accountAuth;
  accountData: typeof accountData;
  accounts: typeof accounts;
  crons: typeof crons;
  errorReports: typeof errorReports;
  http: typeof http;
  replays: typeof replays;
  requestLimits: typeof requestLimits;
  rooms: typeof rooms;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

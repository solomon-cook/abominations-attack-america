import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("expire stale room connections and advance bots", { seconds: 30 }, internal.rooms.processStaleParticipants, {});
crons.interval("expire idle guest rooms", { hours: 1 }, internal.rooms.expireIdleRooms, {});
crons.interval("clean up expired HTTP rate limit buckets", { hours: 1 }, internal.requestLimits.deleteExpired, {});

export default crons;

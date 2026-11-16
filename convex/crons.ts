import { cronJobs } from "convex/server";

// Room cleanup and rate-limit expiry are scheduled only when those records are created or active.
export default cronJobs();

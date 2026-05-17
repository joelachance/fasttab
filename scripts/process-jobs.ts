import "../src/env.js";

import { processFoodrunJobs } from "../src/foodrun/job-worker.js";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 1;

if (!Number.isFinite(limit) || limit < 1) {
  console.error("Usage: bun run foodrun:jobs [--limit=N]");
  process.exit(1);
}

const result = await processFoodrunJobs(limit);

console.log(JSON.stringify(result, null, 2));

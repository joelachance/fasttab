import { describe, expect, test } from "bun:test";

import {
  FOODRUN_JOB_MAX_DURATION_SECONDS,
  processFoodrunJobs,
} from "../src/foodrun/job-worker";

describe("processFoodrunJobs", () => {
  test("uses Vercel's five-minute worker budget", () => {
    expect(FOODRUN_JOB_MAX_DURATION_SECONDS).toBe(300);
  });

  test("starts with no active handlers until orchestration is wired", async () => {
    await expect(processFoodrunJobs()).resolves.toEqual({
      processed: 0,
      supportedKinds: [],
    });
  });
});

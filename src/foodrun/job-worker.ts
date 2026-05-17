import { OrderSessionStore } from "./order-session-store.js";
import type { FoodrunJobKind } from "./order-state.js";

export const FOODRUN_JOB_MAX_DURATION_SECONDS = 300;

export type ProcessFoodrunJobsResult = {
  processed: number;
  supportedKinds: FoodrunJobKind[];
};

const SUPPORTED_JOB_KINDS: FoodrunJobKind[] = [];

export async function processFoodrunJobs(
  _limit = 1,
  _store = new OrderSessionStore(),
): Promise<ProcessFoodrunJobsResult> {
  return {
    processed: 0,
    supportedKinds: SUPPORTED_JOB_KINDS,
  };
}

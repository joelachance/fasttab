import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { requiredEnv, type Env } from "../env.js";

export type FoodrunSqlClient = Pick<NeonQueryFunction<false, false>, "query">;

export function createPostgresClient(env: Env = process.env): FoodrunSqlClient {
  return neon(requiredEnv(env, "DATABASE_URL"));
}

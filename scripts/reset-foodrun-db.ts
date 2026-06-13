import { createPostgresClient } from "../src/modules/postgres.js";

/** App data tables from migrations/*.sql — excludes foodrun_schema_migrations. */
const APP_TABLES = [
  "foodrun_cart_item_assignments",
  "foodrun_participant_payments",
  "foodrun_cart_items",
  "foodrun_order_participants",
  "foodrun_jobs",
  "foodrun_order_events",
  "agentphone_webhook_deliveries",
  "foodrun_order_sessions",
] as const;

const sql = createPostgresClient();

const tableList = APP_TABLES.map((t) => `"${t}"`).join(", ");
await sql.query(
  `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
);

const counts = await Promise.all(
  APP_TABLES.map(async (table) => {
    const rows = (await sql.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)) as Array<{
      n: number;
    }>;
    return { table, count: rows[0]?.n ?? -1 };
  }),
);

const migrationRows = (await sql.query(
  "SELECT COUNT(*)::int AS n FROM foodrun_schema_migrations",
)) as Array<{ n: number }>;

console.log("Cleared tables:");
for (const { table, count } of counts) {
  console.log(`  ${table}: ${count} rows`);
}
console.log(`  foodrun_schema_migrations: ${migrationRows[0]?.n ?? 0} rows (preserved)`);

const bad = counts.filter(({ count }) => count !== 0);
if (bad.length > 0) {
  console.error("Reset failed — non-zero row counts:", bad);
  process.exit(1);
}

console.log("Database reset complete.");

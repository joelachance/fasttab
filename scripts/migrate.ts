import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createPostgresClient } from "../src/modules/postgres.js";
import { splitSqlStatements } from "../src/modules/sql-script.js";

const migrationsDir = path.join(process.cwd(), "migrations");
const sql = createPostgresClient();

await sql.query(`
  CREATE TABLE IF NOT EXISTS foodrun_schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const appliedRows = (await sql.query(
  "SELECT filename FROM foodrun_schema_migrations",
)) as Array<{ filename: string }>;
const applied = new Set(appliedRows.map((row) => row.filename));
const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`Skipping ${file}`);
    continue;
  }

  const migration = splitSqlStatements(await readFile(path.join(migrationsDir, file), "utf8"));

  console.log(`Applying ${file}`);
  await sql.query("BEGIN");

  try {
    for (const statement of migration) {
      await sql.query(statement);
    }

    await sql.query("INSERT INTO foodrun_schema_migrations (filename) VALUES ($1)", [file]);
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
}

console.log("Migrations complete");

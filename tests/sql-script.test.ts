import { describe, expect, test } from "bun:test";

import { splitSqlStatements } from "../src/modules/sql-script";

describe("splitSqlStatements", () => {
  test("splits semicolon-delimited SQL statements", () => {
    expect(splitSqlStatements("CREATE TABLE test (id text); SELECT 1;")).toEqual([
      "CREATE TABLE test (id text)",
      "SELECT 1",
    ]);
  });

  test("preserves semicolons inside dollar-quoted function bodies", () => {
    const script = `
      CREATE FUNCTION test_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER test_trigger
      BEFORE UPDATE ON test
      FOR EACH ROW EXECUTE FUNCTION test_fn();
    `;

    const statements = splitSqlStatements(script);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("NEW.updated_at = now();");
    expect(statements[1]).toStartWith("CREATE TRIGGER test_trigger");
  });
});

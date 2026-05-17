export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let dollarQuoteTag: string | null = null;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i]!;
    const nextDollarQuoteTag = readDollarQuoteTag(script, i);

    if (nextDollarQuoteTag) {
      current += nextDollarQuoteTag;
      i += nextDollarQuoteTag.length - 1;
      dollarQuoteTag = dollarQuoteTag === nextDollarQuoteTag ? null : nextDollarQuoteTag;
      continue;
    }

    if (char === ";" && !dollarQuoteTag) {
      const statement = current.trim();

      if (statement) {
        statements.push(statement);
      }

      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();

  if (last) {
    statements.push(last);
  }

  return statements;
}

function readDollarQuoteTag(script: string, index: number): string | null {
  if (script[index] !== "$") {
    return null;
  }

  const match = script.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);

  return match?.[0] ?? null;
}

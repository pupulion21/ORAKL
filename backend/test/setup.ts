// ORAKL P1 — test bootstrap: load .env (LOCAL SIMULATION ONLY) before tests.
// Test suites share the local PostgreSQL instance but always touch their own
// synthetic chain ids so the real indexer chain is never disturbed.
import { readFileSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // .env missing: tests supply their own DATABASE_URL.
}

if (process.env.DATABASE_URL == null) {
  process.env.DATABASE_URL = "postgresql://orakl:orakl_local_p1@127.0.0.1:5432/orakl_p1?schema=public";
}

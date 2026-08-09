import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { loadEnvConfig } = nextEnv;
loadEnvConfig(projectRoot);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const migration = await readFile(
  new URL("../db/migrations/0001_support_callbacks.sql", import.meta.url),
  "utf8",
);
const sql = neon(process.env.DATABASE_URL);
const statements = migration
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}

console.log("Applied 0001_support_callbacks.sql");

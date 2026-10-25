import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "./client";

export async function runMigrations() {
  const migrationsFolder = process.env.LASSO_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
  await sqlClient()`select pg_advisory_lock(727274)`;
  try {
    await migrate(db(), { migrationsFolder });
  } finally {
    await sqlClient()`select pg_advisory_unlock(727274)`;
  }
}

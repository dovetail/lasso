import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { lassoSql?: postgres.Sql; lassoDb?: DB };

export function sqlClient(): postgres.Sql {
  globalForDb.lassoSql ??= postgres(env().DATABASE_URL, {
    max: 10,
    onnotice: () => {},
  });
  return globalForDb.lassoSql;
}

export function db(): DB {
  globalForDb.lassoDb ??= drizzle(sqlClient(), { schema });
  return globalForDb.lassoDb;
}

export { schema };

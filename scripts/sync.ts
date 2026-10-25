import { sqlClient } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { syncAll, type ConnectorId } from "../src/ingest/sync";

const only = process.argv.slice(2).filter((a): a is ConnectorId => ["github", "cursor", "claude"].includes(a));
await runMigrations();
const results = await syncAll(only.length ? { only } : {});
console.log(JSON.stringify(results, null, 2));
await sqlClient().end();

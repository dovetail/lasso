import { runMigrations } from "../src/db/migrate";
import { sqlClient } from "../src/db/client";

await runMigrations();
await sqlClient().end();
console.log("migrations applied");

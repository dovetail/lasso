import { db, sqlClient } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { seedDemo } from "../src/demo/seed";

await runMigrations();
if (process.argv.includes("--reset")) {
  await sqlClient()`truncate people, platform_accounts, github_teams, budgets, findings, limit_events, sync_runs, raw_payloads, app_settings, identity_overrides restart identity cascade`;
}
await seedDemo(db());
await sqlClient().end();

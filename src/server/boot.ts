import { db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { connectorConfig, env } from "@/lib/env";

const g = globalThis as unknown as { lassoBoot?: Promise<void> };

async function doBoot() {
  const e = env();
  if (e.LASSO_AUTH_MODE === "oidc" && !e.LASSO_SESSION_SECRET) {
    throw new Error("LASSO_SESSION_SECRET is required when LASSO_AUTH_MODE=oidc");
  }
  await runMigrations();
  console.log("[lasso] database migrated");

  if (e.LASSO_DEMO) {
    const { seedDemoIfEmpty } = await import("@/demo/seed");
    await seedDemoIfEmpty(db());
  }

  if (e.LASSO_ROLE !== "web") {
    const { startWorker, enqueueSync } = await import("./jobs");
    await startWorker();
    const cfg = connectorConfig();
    if (cfg.cursor || cfg.claudeAnalytics || cfg.claudeLimits || cfg.github) {
      const prior = await db().query.syncRuns.findFirst();
      if (!prior) {
        console.log("[lasso] no sync history; queueing initial sync");
        await enqueueSync();
      }
    }
  }
}

export function boot(): Promise<void> {
  g.lassoBoot ??= doBoot().catch((err) => {
    console.error("[lasso] boot failed:", err);
    g.lassoBoot = undefined;
    throw err;
  });
  return g.lassoBoot;
}

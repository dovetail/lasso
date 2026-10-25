import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const SYNC_QUEUE = "lasso-sync";
export const PRUNE_QUEUE = "lasso-prune";

const g = globalThis as unknown as { lassoBoss?: Promise<PgBoss> };

async function create(worker: boolean): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env().DATABASE_URL,
    schema: "pgboss",
    supervise: worker,
    schedule: worker,
  });
  boss.on("error", (err) => console.error("[lasso] job queue error:", err));
  await boss.start();
  await boss.createQueue(SYNC_QUEUE, { policy: "stately", expireInSeconds: 3600, retryLimit: 1 }).catch(() => {});
  await boss.createQueue(PRUNE_QUEUE, { policy: "stately" }).catch(() => {});
  return boss;
}

export function getBoss(worker = false): Promise<PgBoss> {
  g.lassoBoss ??= create(worker);
  return g.lassoBoss;
}

export async function enqueueSync() {
  const boss = await getBoss(env().LASSO_ROLE !== "web");
  return boss.send(SYNC_QUEUE, {});
}

export async function startWorker() {
  const boss = await getBoss(true);
  const { syncAll, pruneOldData } = await import("@/ingest/sync");

  await boss.schedule(SYNC_QUEUE, env().LASSO_SYNC_CRON, {});
  await boss.schedule(PRUNE_QUEUE, "30 3 * * *", {});

  await boss.work(SYNC_QUEUE, async () => {
    const started = Date.now();
    const results = await syncAll();
    console.log(`[lasso] sync finished in ${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(results));
  });
  await boss.work(PRUNE_QUEUE, async () => {
    await pruneOldData();
  });
  console.log(`[lasso] worker started (sync cron "${env().LASSO_SYNC_CRON}")`);
}

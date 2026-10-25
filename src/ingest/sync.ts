import { and, desc, eq, lt, sql } from "drizzle-orm";
import { ClaudeClient, fetchClaude, normaliseClaude } from "@/connectors/claude";
import { CLAUDE_CSV, parseClaudeCsv } from "@/connectors/claudeCsv";
import { CursorClient, fetchCursor, normaliseCursor } from "@/connectors/cursor";
import { GithubClient } from "@/connectors/github";
import { db as getDb, type DB } from "@/db/client";
import { activityDaily, rawPayloads, syncRuns, usageDaily } from "@/db/schema";
import { recordFindings } from "@/analysis/runFindings";
import { recordLimitEvents } from "@/analysis/limitEvents";
import { addDays, today, type Day } from "@/lib/dates";
import { connectorConfig, env } from "@/lib/env";
import { resolveIdentities, writeGithubSnapshot } from "./identity";
import { storeRaw, writeBatch } from "./writer";

export type ConnectorId = "github" | "cursor" | "claude";

interface RunResult {
  rows: number;
  range?: [Day, Day];
}

async function lastSuccessfulEnd(db: DB, connector: string): Promise<Day | null> {
  const row = await db.query.syncRuns.findFirst({
    where: and(eq(syncRuns.connector, connector), eq(syncRuns.status, "success")),
    orderBy: desc(syncRuns.startedAt),
  });
  return row?.rangeEnd ?? null;
}

async function recordRun(db: DB, connector: string, fn: () => Promise<RunResult>) {
  const [run] = await db.insert(syncRuns).values({ connector }).returning({ id: syncRuns.id });
  try {
    const res = await fn();
    await db
      .update(syncRuns)
      .set({ status: "success", finishedAt: new Date(), rowsWritten: res.rows, rangeStart: res.range?.[0], rangeEnd: res.range?.[1] })
      .where(eq(syncRuns.id, run!.id));
    return { ok: true as const, ...res };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lasso] ${connector} sync failed: ${message}`);
    await db.update(syncRuns).set({ status: "error", finishedAt: new Date(), error: message.slice(0, 4000) }).where(eq(syncRuns.id, run!.id));
    return { ok: false as const, error: message };
  }
}

async function syncRange(db: DB, connector: string): Promise<{ range: [Day, Day]; firstRun: boolean }> {
  const last = await lastSuccessfulEnd(db, connector);
  const end = addDays(today(), 1);
  // Re-read the last few days: platforms finalise usage late.
  const start = last ? addDays(last, -4) : addDays(end, -env().LASSO_BACKFILL_DAYS);
  return { range: [start, end], firstRun: !last };
}

async function syncGithub(db: DB): Promise<RunResult> {
  const e = env();
  const client = new GithubClient(
    e.GITHUB_ORG!,
    { token: e.GITHUB_TOKEN, appId: e.GITHUB_APP_ID, installationId: e.GITHUB_APP_INSTALLATION_ID, privateKey: e.GITHUB_APP_PRIVATE_KEY },
    e.GITHUB_API_BASE,
  );
  const snap = await client.snapshot();
  for (const w of snap.warnings) console.warn(`[lasso] github: ${w}`);
  await storeRaw(db, [{ connector: "github", kind: "snapshot", rangeStart: today(), rangeEnd: null, payload: snap }]);
  return { rows: await writeGithubSnapshot(db, snap) };
}

async function syncCursor(db: DB): Promise<RunResult> {
  const e = env();
  const { range, firstRun } = await syncRange(db, "cursor");
  const raws = await fetchCursor(new CursorClient(e.CURSOR_API_KEY!, e.CURSOR_API_BASE), range[0], range[1]);
  await storeRaw(db, raws);
  const rows = await writeBatch(db, normaliseCursor(raws), { seatStartDefault: firstRun ? range[0] : undefined });
  return { rows, range };
}

async function syncClaude(db: DB): Promise<RunResult> {
  const e = env();
  const { range, firstRun } = await syncRange(db, "claude");
  const client = new ClaudeClient({ analyticsKey: e.CLAUDE_ANALYTICS_API_KEY, adminKey: e.CLAUDE_ADMIN_API_KEY }, e.CLAUDE_API_BASE);
  const raws = await fetchClaude(client, range[0], range[1]);
  await storeRaw(db, raws);
  const rows = await writeBatch(db, normaliseClaude(raws), { seatStartDefault: firstRun ? range[0] : undefined });
  return { rows, range };
}

/** Recompute derived data: identities, limit events, findings. */
export async function refreshDerived(db: DB = getDb()) {
  await resolveIdentities(db);
  await recordLimitEvents(db);
  await recordFindings(db);
}

export async function syncAll(opts: { only?: ConnectorId[] } = {}) {
  const db = getDb();
  const cfg = connectorConfig();
  const want = (id: ConnectorId) => !opts.only || opts.only.includes(id);
  const results: Record<string, { ok: boolean; rows?: number; error?: string }> = {};

  if (cfg.github && want("github")) results.github = await recordRun(db, "github", () => syncGithub(db));
  if (cfg.cursor && want("cursor")) results.cursor = await recordRun(db, "cursor", () => syncCursor(db));
  if ((cfg.claudeAnalytics || cfg.claudeLimits) && want("claude")) results.claude = await recordRun(db, "claude", () => syncClaude(db));

  await recordRun(db, "derived", async () => {
    await refreshDerived(db);
    return { rows: 0 };
  });
  return results;
}

export async function importClaudeCsv(text: string) {
  const db = getDb();
  const parsed = parseClaudeCsv(text);
  if (parsed.rowCount === 0) return { ok: false as const, errors: parsed.errors, rows: 0 };
  const result = await recordRun(db, CLAUDE_CSV, async () => {
    await storeRaw(db, [{ connector: CLAUDE_CSV, kind: "upload", rangeStart: parsed.range?.[0] ?? null, rangeEnd: parsed.range?.[1] ?? null, payload: { text } }]);
    const rows = await writeBatch(db, parsed.batch, { seatStartDefault: parsed.range?.[0] });
    return { rows, range: parsed.range ?? undefined };
  });
  if (result.ok) await refreshDerived(db);
  return { ok: result.ok, errors: parsed.errors, rows: parsed.rowCount, error: result.ok ? undefined : result.error };
}

export async function pruneOldData() {
  const db = getDb();
  const cutoff = addDays(today(), -env().LASSO_RETENTION_DAYS);
  await db.delete(usageDaily).where(lt(usageDaily.day, cutoff));
  await db.delete(activityDaily).where(lt(activityDaily.day, cutoff));
  await db.delete(rawPayloads).where(lt(rawPayloads.fetchedAt, new Date(`${cutoff}T00:00:00Z`)));
  await db.delete(syncRuns).where(lt(syncRuns.startedAt, sql`now() - interval '90 days'`));
}

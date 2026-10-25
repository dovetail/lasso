import { and, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { ActivityRecord, NormalisedBatch, RawPayload, UsageRecord } from "@/connectors/types";
import type { DB } from "@/db/client";
import { activityDaily, limitIncreaseRequests, platformAccounts, platformLimits, rawPayloads, seats, usageDaily, type Platform } from "@/db/schema";
import { today, type Day } from "@/lib/dates";

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Postgres rejects an upsert that touches the same row twice, so sum duplicates first. */
function mergeUsage(rows: UsageRecord[]): UsageRecord[] {
  const m = new Map<string, UsageRecord>();
  for (const r of rows) {
    const k = `${r.platform}|${r.externalId}|${r.product}|${r.model}|${r.day}`;
    const e = m.get(k);
    if (!e) m.set(k, { ...r });
    else {
      e.requests += r.requests;
      e.inputTokens += r.inputTokens;
      e.outputTokens += r.outputTokens;
      e.cacheReadTokens += r.cacheReadTokens;
      e.cacheWriteTokens += r.cacheWriteTokens;
      e.costUsd += r.costUsd;
      e.costIsEstimated ||= r.costIsEstimated;
    }
  }
  return [...m.values()];
}

function mergeActivity(rows: ActivityRecord[]): ActivityRecord[] {
  const m = new Map<string, ActivityRecord>();
  for (const r of rows) {
    const k = `${r.platform}|${r.externalId}|${r.product}|${r.day}`;
    const e = m.get(k);
    if (!e) m.set(k, { ...r });
    else {
      e.isActive ||= r.isActive;
      e.sessions += r.sessions;
      e.messages += r.messages;
      e.linesAdded += r.linesAdded;
      e.linesAccepted += r.linesAccepted;
      e.commits += r.commits;
      e.pullRequests += r.pullRequests;
      e.mostUsedModel ??= r.mostUsedModel;
    }
  }
  return [...m.values()];
}

function dedupeBy<T>(rows: T[], key: (r: T) => string): T[] {
  return [...new Map(rows.map((r) => [key(r), r])).values()];
}

export async function storeRaw(db: DB, raws: RawPayload[]) {
  for (const r of raws) {
    await db.insert(rawPayloads).values({
      connector: r.connector,
      kind: r.kind,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      payload: r.payload as object,
    });
  }
}

export interface WriteOptions {
  /** started_on for seats first seen in this batch. */
  seatStartDefault?: Day;
}

/** Persist a normalised batch. Returns rows written. */
export async function writeBatch(db: DB, batch: NormalisedBatch, opts: WriteOptions = {}): Promise<number> {
  let written = 0;
  const accountIds = new Map<string, number>();
  const key = (p: Platform, ext: string) => `${p}|${ext}`;

  const uniqueAccounts = new Map(batch.accounts.map((a) => [key(a.platform, a.externalId), a]));
  for (const part of chunks([...uniqueAccounts.values()])) {
    const rows = await db
      .insert(platformAccounts)
      .values(
        part.map((a) => ({
          platform: a.platform,
          externalId: a.externalId,
          email: a.email,
          name: a.name,
          isRemoved: a.isRemoved ?? false,
        })),
      )
      .onConflictDoUpdate({
        target: [platformAccounts.platform, platformAccounts.externalId],
        set: {
          email: sql`coalesce(excluded.email, ${platformAccounts.email})`,
          name: sql`coalesce(excluded.name, ${platformAccounts.name})`,
          isRemoved: sql`excluded.is_removed`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: platformAccounts.id, platform: platformAccounts.platform, externalId: platformAccounts.externalId });
    for (const r of rows) accountIds.set(key(r.platform, r.externalId), r.id);
  }
  const idFor = (p: Platform, ext: string) => {
    const id = accountIds.get(key(p, ext));
    if (id == null) throw new Error(`No account for ${p}:${ext} in batch`);
    return id;
  };

  for (const c of batch.coverage ?? []) {
    const table = c.table === "usage" ? usageDaily : activityDaily;
    const conds = [eq(table.platform, c.platform), gte(table.day, c.from), lt(table.day, c.toExclusive)];
    if (c.products?.length) conds.push(inArray(table.product, c.products));
    await db.delete(table).where(and(...conds));
  }

  for (const part of chunks(mergeUsage(batch.usage))) {
    await db
      .insert(usageDaily)
      .values(part.map(({ externalId, ...u }) => ({ ...u, platformAccountId: idFor(u.platform, externalId) })))
      .onConflictDoUpdate({
        target: [usageDaily.platformAccountId, usageDaily.product, usageDaily.model, usageDaily.day],
        set: {
          requests: sql`excluded.requests`,
          inputTokens: sql`excluded.input_tokens`,
          outputTokens: sql`excluded.output_tokens`,
          cacheReadTokens: sql`excluded.cache_read_tokens`,
          cacheWriteTokens: sql`excluded.cache_write_tokens`,
          costUsd: sql`excluded.cost_usd`,
          costIsEstimated: sql`excluded.cost_is_estimated`,
        },
      });
    written += part.length;
  }

  for (const part of chunks(mergeActivity(batch.activity))) {
    await db
      .insert(activityDaily)
      .values(part.map(({ externalId, ...a }) => ({ ...a, platformAccountId: idFor(a.platform, externalId) })))
      .onConflictDoUpdate({
        target: [activityDaily.platformAccountId, activityDaily.product, activityDaily.day],
        set: {
          isActive: sql`excluded.is_active`,
          sessions: sql`excluded.sessions`,
          messages: sql`excluded.messages`,
          linesAdded: sql`excluded.lines_added`,
          linesAccepted: sql`excluded.lines_accepted`,
          commits: sql`excluded.commits`,
          pullRequests: sql`excluded.pull_requests`,
          mostUsedModel: sql`excluded.most_used_model`,
        },
      });
    written += part.length;
  }

  const limits = dedupeBy(batch.limits, (l) => `${l.platform}|${l.externalId}|${l.limitKind}|${l.period}|${l.cycleStart}`);
  for (const part of chunks(limits)) {
    await db
      .insert(platformLimits)
      .values(
        part.map((l) => ({
          platformAccountId: idFor(l.platform, l.externalId),
          platform: l.platform,
          limitKind: l.limitKind,
          period: l.period,
          source: l.source,
          limitUsd: l.limitUsd,
          usedUsd: l.usedUsd,
          cycleStart: l.cycleStart,
        })),
      )
      .onConflictDoUpdate({
        target: [platformLimits.platformAccountId, platformLimits.limitKind, platformLimits.period, platformLimits.cycleStart],
        set: {
          limitUsd: sql`excluded.limit_usd`,
          usedUsd: sql`excluded.used_usd`,
          source: sql`excluded.source`,
          capturedAt: sql`now()`,
        },
      });
    written += part.length;
  }

  for (const part of chunks(dedupeBy(batch.increaseRequests, (r) => `${r.platform}|${r.externalId}`))) {
    await db
      .insert(limitIncreaseRequests)
      .values(
        part.map((r) => ({
          platform: r.platform,
          externalId: r.externalId,
          platformAccountId: idFor(r.platform, r.accountExternalId),
          status: r.status,
          requestedAt: new Date(r.requestedAt),
          resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
          limitUsdAtRequest: r.limitUsdAtRequest,
          spendUsdAtRequest: r.spendUsdAtRequest,
        })),
      )
      .onConflictDoUpdate({
        target: [limitIncreaseRequests.platform, limitIncreaseRequests.externalId],
        set: { status: sql`excluded.status`, resolvedAt: sql`excluded.resolved_at` },
      });
    written += part.length;
  }

  if (batch.seatRoster) {
    const platformsInRoster = new Set(batch.seatRoster.map((s) => s.platform));
    for (const platform of platformsInRoster) {
      const roster = dedupeBy(
        batch.seatRoster.filter((s) => s.platform === platform),
        (s) => s.externalId,
      );
      const ids = roster.map((s) => idFor(s.platform, s.externalId));
      const closeConds = [eq(seats.platform, platform), isNull(seats.endedOn)];
      if (ids.length) closeConds.push(notInArray(seats.platformAccountId, ids));
      await db.update(seats).set({ endedOn: today() }).where(and(...closeConds));
      for (const part of chunks(roster)) {
        await db
          .insert(seats)
          .values(
            part.map((s) => ({
              platformAccountId: idFor(s.platform, s.externalId),
              platform: s.platform,
              seatType: s.seatType,
              startedOn: opts.seatStartDefault ?? today(),
            })),
          )
          .onConflictDoNothing();
      }
    }
  }

  return written;
}

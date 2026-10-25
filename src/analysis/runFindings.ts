import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { findings, githubTeams, limitIncreaseRequests, people, platformAccounts, seats, teamMemberships } from "@/db/schema";
import { addDays, today, type Day } from "@/lib/dates";
import { connectorConfig, env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { evaluateFindings, type FindingDraft, type FindingsInput } from "./findings";
import { limitHistory } from "./queries";

export async function loadFindingsInput(db: DB, asOf: Day = today()): Promise<FindingsInput> {
  const from = addDays(asOf, -70);
  const settings = await getSettings(db);

  const personRows = await db.select().from(people);
  const personLabel = new Map(personRows.map((p) => [p.id, p.displayName ?? p.githubLogin ?? p.primaryEmail ?? `#${p.id}`]));
  const openSeats = await db.select().from(seats).where(isNull(seats.endedOn));
  const seatStart = new Map(openSeats.map((s) => [s.platformAccountId, s.startedOn]));
  const accounts = (await db.select().from(platformAccounts)).map((a) => ({
    id: a.id,
    platform: a.platform,
    personId: a.personId,
    label: (a.personId != null ? personLabel.get(a.personId) : null) ?? a.name ?? a.email ?? a.externalId,
    matchSource: a.matchSource,
    isRemoved: a.isRemoved,
    openSeatStartedOn: seatStart.get(a.id) ?? null,
  }));
  const personOf = new Map(accounts.map((a) => [a.id, a.personId]));

  const usage = (
    (await db.execute(sql`
      select platform_account_id, platform, model, day::text as day, requests, input_tokens + output_tokens as tokens, cost_usd
      from usage_daily where day >= ${from} and day < ${asOf}`)) as unknown as Array<Record<string, unknown>>
  ).map((r) => ({
    accountId: Number(r.platform_account_id),
    personId: personOf.get(Number(r.platform_account_id)) ?? null,
    platform: r.platform as "cursor" | "claude",
    model: String(r.model),
    day: String(r.day),
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    costUsd: Number(r.cost_usd),
  }));

  const activeDays = (
    (await db.execute(sql`
      select distinct platform_account_id, day::text as day from activity_daily
      where is_active and day >= ${from} and day < ${asOf}`)) as unknown as Array<Record<string, unknown>>
  ).map((r) => ({ accountId: Number(r.platform_account_id), day: String(r.day) }));

  const teamRows = await db.select().from(githubTeams);
  const memberships = await db.select().from(teamMemberships).where(isNull(teamMemberships.endedOn));
  const teams = teamRows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    memberPersonIds: memberships.filter((m) => m.teamId === t.id).map((m) => m.personId),
  }));

  const reqs = await db.select().from(limitIncreaseRequests);

  return {
    asOf,
    settings,
    githubConfigured: connectorConfig().github || env().LASSO_DEMO,
    accounts,
    people: personRows.map((p) => ({ id: p.id, label: personLabel.get(p.id)! })),
    usage,
    activeDays,
    teams,
    limitHistory: await limitHistory(db),
    increaseRequests: reqs
      .filter((r) => r.platformAccountId != null)
      .map((r) => ({ accountId: r.platformAccountId!, requestedAt: r.requestedAt.toISOString().slice(0, 10) })),
  };
}

export async function persistFindings(db: DB, drafts: FindingDraft[], asOf: Day = today()) {
  const seen = new Set<number>();
  for (const f of drafts) {
    const existing = await db.query.findings.findFirst({
      where: and(eq(findings.ruleId, f.ruleId), eq(findings.subjectType, f.subjectType), eq(findings.subjectKey, f.subjectKey), ne(findings.status, "resolved")),
    });
    if (existing) {
      await db
        .update(findings)
        .set({ severity: f.severity, title: f.title, detail: f.detail, evidence: f.evidence, monthlyImpactUsd: f.monthlyImpactUsd, lastSeenOn: asOf, updatedAt: new Date() })
        .where(eq(findings.id, existing.id));
      seen.add(existing.id);
    } else {
      const [row] = await db
        .insert(findings)
        .values({ ...f, firstSeenOn: asOf, lastSeenOn: asOf })
        .returning({ id: findings.id });
      seen.add(row!.id);
    }
  }
  const stale = await db.query.findings.findMany({ where: and(eq(findings.status, "open"), lt(findings.lastSeenOn, asOf)) });
  const toResolve = stale.filter((f) => !seen.has(f.id)).map((f) => f.id);
  if (toResolve.length) await db.update(findings).set({ status: "resolved", updatedAt: new Date() }).where(inArray(findings.id, toResolve));
  return { open: seen.size, resolved: toResolve.length };
}

export async function recordFindings(db: DB, asOf: Day = today()) {
  const input = await loadFindingsInput(db, asOf);
  return persistFindings(db, evaluateFindings(input), asOf);
}

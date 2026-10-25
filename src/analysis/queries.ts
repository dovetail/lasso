import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { Platform, Product } from "@/db/schema";
import { addDays, daysBetween, startOfMonth, type Day } from "@/lib/dates";

export interface Scope {
  teamId?: number;
  personId?: number;
}

async function rows<T>(db: DB, q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Join + filter fragment that restricts usage_daily `u` to a scope, attributing by membership on the day. */
function scopeJoin(scope: Scope, dayCol: SQL = sql`u.day`): SQL {
  const parts: SQL[] = [sql`join platform_accounts pa on pa.id = u.platform_account_id`];
  if (scope.teamId != null) {
    parts.push(
      sql`join team_memberships tm on tm.person_id = pa.person_id and ${dayCol} >= tm.started_on and (tm.ended_on is null or ${dayCol} < tm.ended_on) and tm.team_id = ${scope.teamId}`,
    );
  }
  if (scope.personId != null) parts.push(sql`and pa.person_id = ${scope.personId}`);
  return sql.join(parts, sql` `);
}

export interface SpendRow {
  day: Day;
  platform: Platform;
  product: Product;
  cost: number;
  requests: number;
}

export async function spendSeries(db: DB, from: Day, toExclusive: Day, scope: Scope = {}): Promise<SpendRow[]> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select u.day::text as day, u.platform, u.product, sum(u.cost_usd) as cost, sum(u.requests) as requests
        from usage_daily u ${scopeJoin(scope)}
        where u.day >= ${from} and u.day < ${toExclusive}
        group by 1, 2, 3 order by 1`,
  );
  return r.map((x) => ({ day: x.day as Day, platform: x.platform as Platform, product: x.product as Product, cost: num(x.cost), requests: num(x.requests) }));
}

export interface SeatRow {
  platform: Platform;
  startedOn: Day;
  endedOn: Day | null;
  accountId: number;
}

export async function seatsInRange(db: DB, from: Day, toExclusive: Day, scope: Scope = {}): Promise<SeatRow[]> {
  const scopeSql =
    scope.teamId != null
      ? sql`and exists (select 1 from team_memberships tm where tm.person_id = pa.person_id and tm.team_id = ${scope.teamId} and tm.ended_on is null)`
      : scope.personId != null
        ? sql`and pa.person_id = ${scope.personId}`
        : sql``;
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select s.platform, s.started_on::text as started_on, s.ended_on::text as ended_on, s.platform_account_id as account_id
        from seats s join platform_accounts pa on pa.id = s.platform_account_id
        where s.started_on < ${toExclusive} and (s.ended_on is null or s.ended_on > ${from}) ${scopeSql}`,
  );
  return r.map((x) => ({ platform: x.platform as Platform, startedOn: x.started_on as Day, endedOn: (x.ended_on as Day) ?? null, accountId: num(x.account_id) }));
}

/** Prorated seat cost over [from, toExclusive) at monthly prices. */
export function seatCost(seats: SeatRow[], from: Day, toExclusive: Day, price: Record<Platform, number>): Record<Platform, number> {
  const out: Record<Platform, number> = { cursor: 0, claude: 0 };
  const dailyFactor = 12 / 365;
  for (const s of seats) {
    const start = s.startedOn > from ? s.startedOn : from;
    const end = s.endedOn && s.endedOn < toExclusive ? s.endedOn : toExclusive;
    const days = Math.max(0, daysBetween(start, end));
    out[s.platform] += days * price[s.platform] * dailyFactor;
  }
  return out;
}

export function openSeatCounts(seats: SeatRow[], day: Day): Record<Platform, number> {
  const out: Record<Platform, number> = { cursor: 0, claude: 0 };
  for (const s of seats) if (s.startedOn <= day && (!s.endedOn || s.endedOn > day)) out[s.platform]++;
  return out;
}

export interface PersonRow {
  id: number;
  label: string;
  login: string | null;
  email: string | null;
  teams: string[];
  platforms: Platform[];
  matchSources: string[];
  cost30: number;
  cursor30: number;
  claude30: number;
  mtd: number;
  activeDays30: number;
  lastActive: Day | null;
  topModel: string | null;
}

export async function peopleSummary(db: DB, asOf: Day, scope: Scope = {}): Promise<PersonRow[]> {
  const from30 = addDays(asOf, -30);
  const mtdFrom = startOfMonth(asOf);
  const teamFilter =
    scope.teamId != null
      ? sql`and exists (select 1 from team_memberships tm where tm.person_id = p.id and tm.team_id = ${scope.teamId} and tm.ended_on is null)`
      : sql``;
  const r = await rows<Record<string, unknown>>(
    db,
    sql`
    with acct as (
      select pa.person_id, array_agg(distinct pa.platform) as platforms, array_agg(distinct pa.match_source) as sources
      from platform_accounts pa where pa.person_id is not null and not pa.is_removed group by 1
    ),
    cost as (
      select pa.person_id,
        sum(u.cost_usd) filter (where u.day >= ${from30}) as cost30,
        sum(u.cost_usd) filter (where u.day >= ${from30} and u.platform = 'cursor') as cursor30,
        sum(u.cost_usd) filter (where u.day >= ${from30} and u.platform = 'claude') as claude30,
        sum(u.cost_usd) filter (where u.day >= ${mtdFrom}) as mtd
      from usage_daily u join platform_accounts pa on pa.id = u.platform_account_id
      where u.day >= least(${from30}::date, ${mtdFrom}::date) and u.day <= ${asOf}
      group by 1
    ),
    active as (
      select pa.person_id, count(distinct d.day) filter (where d.day >= ${from30}) as active30, max(d.day)::text as last_active
      from (
        select platform_account_id, day from activity_daily where is_active
        union select platform_account_id, day from usage_daily where requests > 0
      ) d join platform_accounts pa on pa.id = d.platform_account_id
      group by 1
    ),
    model as (
      select distinct on (pa.person_id) pa.person_id, u.model
      from usage_daily u join platform_accounts pa on pa.id = u.platform_account_id
      where u.day >= ${from30} group by pa.person_id, u.model order by pa.person_id, sum(u.cost_usd) desc
    ),
    teams as (
      select tm.person_id, array_agg(t.slug order by t.slug) as slugs
      from team_memberships tm join github_teams t on t.id = tm.team_id where tm.ended_on is null group by 1
    )
    select p.id, coalesce(p.display_name, p.github_login, p.primary_email) as label, p.github_login, p.primary_email,
      coalesce(teams.slugs, '{}') as teams, coalesce(acct.platforms, '{}') as platforms, coalesce(acct.sources, '{}') as sources,
      cost.cost30, cost.cursor30, cost.claude30, cost.mtd, active.active30, active.last_active, model.model as top_model
    from people p
    left join acct on acct.person_id = p.id
    left join cost on cost.person_id = p.id
    left join active on active.person_id = p.id
    left join model on model.person_id = p.id
    left join teams on teams.person_id = p.id
    where (acct.person_id is not null or cost.person_id is not null) ${teamFilter}
    order by cost.cost30 desc nulls last, label`,
  );
  return r.map((x) => ({
    id: num(x.id),
    label: String(x.label ?? x.id),
    login: (x.github_login as string) ?? null,
    email: (x.primary_email as string) ?? null,
    teams: (x.teams as string[]) ?? [],
    platforms: (x.platforms as Platform[]) ?? [],
    matchSources: (x.sources as string[]) ?? [],
    cost30: num(x.cost30),
    cursor30: num(x.cursor30),
    claude30: num(x.claude30),
    mtd: num(x.mtd),
    activeDays30: num(x.active30),
    lastActive: (x.last_active as Day) ?? null,
    topModel: (x.top_model as string) ?? null,
  }));
}

export interface TeamRow {
  id: number;
  slug: string;
  name: string;
  members: number;
  active30: number;
  cost30: number;
  mtd: number;
}

export async function teamSummary(db: DB, asOf: Day): Promise<TeamRow[]> {
  const from30 = addDays(asOf, -30);
  const mtdFrom = startOfMonth(asOf);
  const r = await rows<Record<string, unknown>>(
    db,
    sql`
    with m as (
      select team_id, count(*) as members from team_memberships where ended_on is null group by 1
    ),
    c as (
      select tm.team_id,
        sum(u.cost_usd) filter (where u.day >= ${from30}) as cost30,
        sum(u.cost_usd) filter (where u.day >= ${mtdFrom}) as mtd
      from usage_daily u
      join platform_accounts pa on pa.id = u.platform_account_id
      join team_memberships tm on tm.person_id = pa.person_id and u.day >= tm.started_on and (tm.ended_on is null or u.day < tm.ended_on)
      where u.day >= least(${from30}::date, ${mtdFrom}::date) and u.day <= ${asOf}
      group by 1
    ),
    a as (
      select tm.team_id, count(distinct pa.person_id) as active30
      from (
        select platform_account_id, day from activity_daily where is_active and day >= ${from30}
        union select platform_account_id, day from usage_daily where requests > 0 and day >= ${from30}
      ) d
      join platform_accounts pa on pa.id = d.platform_account_id
      join team_memberships tm on tm.person_id = pa.person_id and tm.ended_on is null
      group by 1
    )
    select t.id, t.slug, t.name, coalesce(m.members, 0) as members, coalesce(a.active30, 0) as active30, c.cost30, c.mtd
    from github_teams t left join m on m.team_id = t.id left join c on c.team_id = t.id left join a on a.team_id = t.id
    where coalesce(m.members, 0) > 0
    order by c.cost30 desc nulls last, t.name`,
  );
  return r.map((x) => ({
    id: num(x.id),
    slug: String(x.slug),
    name: String(x.name),
    members: num(x.members),
    active30: num(x.active30),
    cost30: num(x.cost30),
    mtd: num(x.mtd),
  }));
}

export interface ModelRow {
  platform: Platform;
  model: string;
  cost: number;
  requests: number;
  tokens: number;
  people: number;
}

export async function modelBreakdown(db: DB, from: Day, toExclusive: Day, scope: Scope = {}): Promise<ModelRow[]> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select u.platform, u.model, sum(u.cost_usd) as cost, sum(u.requests) as requests,
          sum(u.input_tokens + u.output_tokens) as tokens, count(distinct pa.person_id) as people
        from usage_daily u ${scopeJoin(scope)}
        where u.day >= ${from} and u.day < ${toExclusive}
        group by 1, 2 order by 3 desc limit 50`,
  );
  return r.map((x) => ({
    platform: x.platform as Platform,
    model: String(x.model),
    cost: num(x.cost),
    requests: num(x.requests),
    tokens: num(x.tokens),
    people: num(x.people),
  }));
}

export interface LimitRow {
  accountId: number;
  personId: number | null;
  label: string;
  platform: Platform;
  limitKind: string;
  period: string;
  source: string | null;
  limitUsd: number | null;
  usedUsd: number;
  cycleStart: Day;
  capturedAt: string;
}

/** Latest snapshot per account/limit/period (current cycle). */
export async function currentLimits(db: DB): Promise<LimitRow[]> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select distinct on (l.platform_account_id, l.limit_kind, l.period)
          l.platform_account_id, pa.person_id, coalesce(p.display_name, pa.name, pa.email, pa.external_id) as label,
          l.platform, l.limit_kind, l.period, l.source, l.limit_usd, l.used_usd, l.cycle_start::text as cycle_start, l.captured_at::text as captured_at
        from platform_limits l
        join platform_accounts pa on pa.id = l.platform_account_id
        left join people p on p.id = pa.person_id
        where not pa.is_removed
        order by l.platform_account_id, l.limit_kind, l.period, l.cycle_start desc, l.captured_at desc`,
  );
  return r.map((x) => ({
    accountId: num(x.platform_account_id),
    personId: x.person_id == null ? null : num(x.person_id),
    label: String(x.label),
    platform: x.platform as Platform,
    limitKind: String(x.limit_kind),
    period: String(x.period),
    source: (x.source as string) ?? null,
    limitUsd: x.limit_usd == null ? null : num(x.limit_usd),
    usedUsd: num(x.used_usd),
    cycleStart: x.cycle_start as Day,
    capturedAt: String(x.captured_at),
  }));
}

export async function limitHistory(db: DB) {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select platform_account_id, limit_kind, cycle_start::text as cycle_start, max(used_usd) as used, max(limit_usd) as lim
        from platform_limits where cycle_start >= now() - interval '120 days'
        group by 1, 2, 3`,
  );
  const map = new Map<string, { accountId: number; limitKind: string; observations: Array<{ cycleStart: Day; usedUsd: number; limitUsd: number | null }> }>();
  for (const x of r) {
    const key = `${x.platform_account_id}|${x.limit_kind}`;
    const entry = map.get(key) ?? { accountId: num(x.platform_account_id), limitKind: String(x.limit_kind), observations: [] };
    entry.observations.push({ cycleStart: x.cycle_start as Day, usedUsd: num(x.used), limitUsd: x.lim == null ? null : num(x.lim) });
    map.set(key, entry);
  }
  return [...map.values()];
}

export async function limitHitCounts(db: DB): Promise<Map<number, { hits: number; requests90: number }>> {
  const hist = await limitHistory(db);
  const reqs = await rows<Record<string, unknown>>(
    db,
    sql`select platform_account_id, count(*) as n from limit_increase_requests
        where requested_at >= now() - interval '90 days' and platform_account_id is not null group by 1`,
  );
  const { cyclesAtLimit } = await import("./limits");
  const out = new Map<number, { hits: number; requests90: number }>();
  for (const h of hist) {
    const cur = out.get(h.accountId) ?? { hits: 0, requests90: 0 };
    cur.hits = Math.max(cur.hits, cyclesAtLimit(h.observations));
    out.set(h.accountId, cur);
  }
  for (const r of reqs) {
    const id = num(r.platform_account_id);
    const cur = out.get(id) ?? { hits: 0, requests90: 0 };
    cur.requests90 = num(r.n);
    out.set(id, cur);
  }
  return out;
}

export async function scopeSpend(db: DB, scopeType: "org" | "team" | "person", scopeId: number | null, from: Day, toExclusive: Day) {
  const scope: Scope = scopeType === "team" ? { teamId: scopeId! } : scopeType === "person" ? { personId: scopeId! } : {};
  const series = await spendSeries(db, from, toExclusive, scope);
  return series.reduce((a, r) => a + r.cost, 0);
}

export async function syncHealth(db: DB) {
  return rows<{ connector: string; status: string; started_at: string; finished_at: string | null; rows_written: number; error: string | null; last_success: string | null }>(
    db,
    sql`select distinct on (connector) connector, status, started_at::text, finished_at::text, rows_written, error,
          (select max(finished_at)::text from sync_runs s2 where s2.connector = s.connector and s2.status = 'success') as last_success
        from sync_runs s order by connector, started_at desc`,
  );
}

export async function dataExtent(db: DB) {
  const [r] = await rows<{ min: string | null; max: string | null; accounts: string }>(
    db,
    sql`select min(day)::text as min, max(day)::text as max, (select count(*) from platform_accounts) as accounts from usage_daily`,
  );
  return { min: (r?.min as Day) ?? null, max: (r?.max as Day) ?? null, accounts: num(r?.accounts) };
}

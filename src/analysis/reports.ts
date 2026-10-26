import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { findings, type Platform } from "@/db/schema";
import { addDays, endOfMonthExclusive, endOfQuarterExclusive, endOfYearExclusive, startOfMonth, startOfQuarter, today, type Day } from "@/lib/dates";
import { getSettings, type Settings } from "@/lib/settings";
import { cycleEndExclusive, limitStatus, projectedAtCycleEnd, type LimitStatus } from "./limits";
import { baselineRunRate, densify, forecast, scenarioRunRate, type RunRateContext, type ScenarioParams } from "./projection";
import { currentLimits, limitHitCounts, openSeatCounts, peopleSummary, seatCost, seatsInRange, spendSeries, type Scope, type SpendRow } from "./queries";

export type { Scope };

export interface ChartPoint {
  day: Day;
  cursor: number | null;
  claude: number | null;
  forecast: number | null;
}

export interface PeriodProjection {
  label: string;
  from: Day;
  toExclusive: Day;
  actualUsage: number;
  forecastUsage: number;
  low: number;
  high: number;
  seatCost: number;
  total: number;
}

function sumBy(rows: SpendRow[], pred: (r: SpendRow) => boolean) {
  return rows.reduce((a, r) => (pred(r) ? a + r.cost : a), 0);
}

function dailyTotals(rows: SpendRow[]) {
  const m = new Map<Day, number>();
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.cost);
  return [...m.entries()].map(([day, value]) => ({ day, value }));
}

export async function costModel(db: DB, scope: Scope = {}, asOf: Day = today()) {
  const settings = await getSettings(db);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const histFrom = addDays(asOf, -90) < yearStart ? addDays(asOf, -90) : yearStart;
  const series = await spendSeries(db, histFrom, addDays(asOf, 1), scope);
  const complete = series.filter((r) => r.day < asOf);
  const history = densify(dailyTotals(complete), addDays(asOf, -56), asOf);

  const periods: Array<[string, Day, Day]> = [
    ["This month", startOfMonth(asOf), endOfMonthExclusive(asOf)],
    ["This quarter", startOfQuarter(asOf), endOfQuarterExclusive(asOf)],
    ["This year", yearStart, endOfYearExclusive(asOf)],
  ];
  const seatsAll = await seatsInRange(db, yearStart, endOfYearExclusive(asOf), scope);
  const projections: PeriodProjection[] = periods.map(([label, from, to]) => {
    const actualUsage = sumBy(complete, (r) => r.day >= from);
    const f = forecast(history, asOf, to);
    const seats = seatCost(seatsAll, from, to, settings.seatPriceUsd);
    const seatTotal = seats.cursor + seats.claude;
    return {
      label,
      from,
      toExclusive: to,
      actualUsage,
      forecastUsage: f.expected,
      low: actualUsage + f.low + seatTotal,
      high: actualUsage + f.high + seatTotal,
      seatCost: seatTotal,
      total: actualUsage + f.expected + seatTotal,
    };
  });

  const monthForecast = forecast(history, asOf, endOfMonthExclusive(asOf));
  const byDay = new Map<Day, ChartPoint>();
  for (const r of series.filter((x) => x.day >= addDays(asOf, -90))) {
    if (r.day >= asOf) continue;
    const p = byDay.get(r.day) ?? { day: r.day, cursor: 0, claude: 0, forecast: null };
    p[r.platform] = (p[r.platform] ?? 0) + r.cost;
    byDay.set(r.day, p);
  }
  for (const d of monthForecast.daily) {
    byDay.set(d.day, { day: d.day, cursor: null, claude: null, forecast: d.value });
  }
  const chart = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  const mtdFrom = startOfMonth(asOf);
  const mtd = {
    cursor: sumBy(series, (r) => r.day >= mtdFrom && r.platform === "cursor"),
    claude: sumBy(series, (r) => r.day >= mtdFrom && r.platform === "claude"),
  };
  const from30 = addDays(asOf, -30);
  const usage30 = {
    cursor: sumBy(complete, (r) => r.day >= from30 && r.platform === "cursor"),
    claude: sumBy(complete, (r) => r.day >= from30 && r.platform === "claude"),
  };
  const byProduct = new Map<string, number>();
  for (const r of complete.filter((x) => x.day >= from30)) byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.cost);

  const monthly = new Map<string, { month: string; cursor: number; claude: number }>();
  for (const r of complete) {
    const month = r.day.slice(0, 7);
    const m = monthly.get(month) ?? { month, cursor: 0, claude: 0 };
    m[r.platform] += r.cost;
    monthly.set(month, m);
  }

  return {
    asOf,
    settings,
    chart,
    projections,
    mtd,
    usage30,
    byProduct: [...byProduct.entries()].map(([product, cost]) => ({ product, cost })).sort((a, b) => b.cost - a.cost),
    seatsNow: openSeatCounts(seatsAll, asOf),
    monthly: [...monthly.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    forecastMethod: monthForecast.method,
    historyDays: monthForecast.historyDays,
  };
}

export async function runRateContext(db: DB, settings: Settings, asOf: Day = today()): Promise<RunRateContext> {
  const from30 = addDays(asOf, -30);
  const seats = openSeatCounts(await seatsInRange(db, asOf, addDays(asOf, 1)), asOf);
  const series = await spendSeries(db, from30, asOf);
  const usage30 = {
    cursor: sumBy(series, (r) => r.platform === "cursor"),
    claude: sumBy(series, (r) => r.platform === "claude"),
  };
  const active = (await db.execute(sql`
    select u.platform, count(distinct pa.person_id) as n from usage_daily u join platform_accounts pa on pa.id = u.platform_account_id
    where u.day >= ${from30} and u.day < ${asOf} and u.requests > 0 group by 1`)) as unknown as Array<{ platform: Platform; n: string }>;
  const activeUsers30 = { cursor: 0, claude: 0 };
  for (const a of active) activeUsers30[a.platform] = Number(a.n);

  const idle = (await db.execute(sql`
    select pa.platform, count(*) as n from findings f join platform_accounts pa on pa.id = f.subject_key::int
    where f.rule_id = 'idle_seat' and f.status = 'open' group by 1`)) as unknown as Array<{ platform: Platform; n: string }>;
  const idleSeats = { cursor: 0, claude: 0 };
  for (const i of idle) idleSeats[i.platform] = Number(i.n);

  let pattern: RegExp | null = null;
  try {
    pattern = new RegExp(settings.thresholds.expensiveModelPattern, "i");
  } catch {}
  const models = (await db.execute(sql`
    select model, sum(cost_usd) as cost from usage_daily where day >= ${from30} and day < ${asOf} group by 1`)) as unknown as Array<{ model: string; cost: string }>;
  const expensiveModelCost30 = pattern ? models.filter((m) => pattern!.test(m.model)).reduce((a, m) => a + Number(m.cost), 0) : 0;

  return { seatPrice: settings.seatPriceUsd, seats, usage30, activeUsers30, idleSeats, expensiveModelCost30 };
}

export async function scenario(db: DB, params: ScenarioParams) {
  const settings = await getSettings(db);
  const ctx = await runRateContext(db, settings);
  const base = baselineRunRate(ctx);
  const next = scenarioRunRate(ctx, params);
  return { ctx, base, next, delta: next.total - base.total };
}

export interface LimitView {
  accountId: number;
  personId: number | null;
  label: string;
  platform: Platform;
  limitKind: string;
  period: string;
  source: string | null;
  limitUsd: number | null;
  usedUsd: number;
  ratio: number | null;
  status: LimitStatus;
  projected: number;
  willExceed: boolean;
  cycleStart: Day;
  cycleEnd: Day;
  cyclesAtLimit: number;
  increaseRequests90: number;
}

export async function limitsView(db: DB, asOf: Day = today()): Promise<LimitView[]> {
  const settings = await getSettings(db);
  const [rows, hits] = await Promise.all([currentLimits(db), limitHitCounts(db)]);
  return rows
    .map((l) => {
      const cycleEnd = cycleEndExclusive(l.period, l.cycleStart);
      const projected = projectedAtCycleEnd(l.usedUsd, l.cycleStart, cycleEnd, asOf);
      const h = hits.get(l.accountId);
      return {
        ...l,
        ratio: l.limitUsd ? l.usedUsd / l.limitUsd : null,
        status: limitStatus(l.usedUsd, l.limitUsd, settings.thresholds.nearLimitRatio),
        projected,
        willExceed: l.limitUsd != null && l.limitUsd > 0 && projected >= l.limitUsd,
        cycleStart: l.cycleStart,
        cycleEnd,
        cyclesAtLimit: h?.hits ?? 0,
        increaseRequests90: h?.requests90 ?? 0,
      };
    })
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
}

export async function openFindings(db: DB, opts: { limit?: number; status?: "open" | "muted" | "resolved" | "all"; subjects?: Array<{ type: string; keys: string[] }> } = {}) {
  const status = opts.status ?? "open";
  const conds = [];
  if (status !== "all") conds.push(eq(findings.status, status));
  if (opts.subjects?.length) {
    const ors = opts.subjects
      .filter((s) => s.keys.length)
      .map((s) => and(eq(findings.subjectType, s.type as "person"), inArray(findings.subjectKey, s.keys)));
    if (!ors.length) return [];
    conds.push(sql`(${sql.join(ors.map((o) => sql`(${o})`), sql` or `)})`);
  }
  const rows = await db
    .select()
    .from(findings)
    .where(conds.length ? and(...conds) : ne(findings.status, "resolved"))
    .orderBy(sql`case ${findings.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(findings.monthlyImpactUsd), desc(findings.lastSeenOn))
    .limit(opts.limit ?? 500);
  return rows;
}

export async function personActivity(db: DB, personId: number, from: Day, toExclusive: Day) {
  const r = (await db.execute(sql`
    select a.product, count(*) filter (where a.is_active) as active_days, sum(a.sessions) as sessions, sum(a.messages) as messages,
      sum(a.lines_added) as lines_added, sum(a.lines_accepted) as lines_accepted, sum(a.commits) as commits, sum(a.pull_requests) as prs
    from activity_daily a join platform_accounts pa on pa.id = a.platform_account_id
    where pa.person_id = ${personId} and a.day >= ${from} and a.day < ${toExclusive}
    group by 1 order by 2 desc`)) as unknown as Array<Record<string, string | null>>;
  return r.map((x) => ({
    product: String(x.product),
    activeDays: Number(x.active_days ?? 0),
    sessions: Number(x.sessions ?? 0),
    messages: Number(x.messages ?? 0),
    linesAdded: Number(x.lines_added ?? 0),
    linesAccepted: Number(x.lines_accepted ?? 0),
    commits: Number(x.commits ?? 0),
    prs: Number(x.prs ?? 0),
  }));
}

export async function budgetsView(db: DB, asOf: Day = today()) {
  const settings = await getSettings(db);
  const rows = (await db.execute(sql`
    select b.id, b.scope_type, b.scope_id, b.amount_usd, b.note,
      case b.scope_type when 'team' then t.name when 'person' then coalesce(p.display_name, p.github_login, p.primary_email) else 'Organisation' end as label
    from budgets b
    left join github_teams t on b.scope_type = 'team' and t.id = b.scope_id
    left join people p on b.scope_type = 'person' and p.id = b.scope_id
    order by b.scope_type, label`)) as unknown as Array<Record<string, string | null>>;
  return Promise.all(
    rows.map(async (b) => {
      const scopeType = b.scope_type as "org" | "team" | "person";
      const scopeId = b.scope_id == null ? null : Number(b.scope_id);
      const scope: Scope = scopeType === "team" ? { teamId: scopeId! } : scopeType === "person" ? { personId: scopeId! } : {};
      const m = await costModel(db, scope, asOf);
      const month = m.projections[0]!;
      const used = m.mtd.cursor + m.mtd.claude;
      const projected = month.actualUsage + month.forecastUsage;
      const amount = Number(b.amount_usd);
      return {
        id: Number(b.id),
        scopeType,
        scopeId,
        label: String(b.label ?? "Unknown"),
        note: b.note,
        amountUsd: amount,
        usedUsd: used,
        projectedUsd: projected,
        ratio: amount ? used / amount : null,
        status: limitStatus(used, amount, settings.thresholds.nearLimitRatio),
        willExceed: projected >= amount,
      };
    }),
  );
}

export async function increaseRequests(db: DB, asOf: Day = today()) {
  const rows = (await db.execute(sql`
    select r.id, r.platform, r.status, r.requested_at::text as requested_at, r.limit_usd_at_request, r.spend_usd_at_request,
      pa.person_id, coalesce(p.display_name, pa.name, pa.email, r.external_id) as label
    from limit_increase_requests r
    left join platform_accounts pa on pa.id = r.platform_account_id
    left join people p on p.id = pa.person_id
    where r.requested_at >= ${addDays(asOf, -90)}::date
    order by r.requested_at desc limit 100`)) as unknown as Array<Record<string, string | null>>;
  return rows.map((r) => ({
    id: Number(r.id),
    platform: r.platform as Platform,
    status: String(r.status),
    requestedAt: String(r.requested_at),
    limitUsd: r.limit_usd_at_request == null ? null : Number(r.limit_usd_at_request),
    spendUsd: r.spend_usd_at_request == null ? null : Number(r.spend_usd_at_request),
    personId: r.person_id == null ? null : Number(r.person_id),
    label: String(r.label),
  }));
}

export async function findingLinks(db: DB, items: Array<{ id: number; subjectType: string; subjectKey: string }>) {
  const accountIds = items.filter((f) => f.subjectType === "account").map((f) => Number(f.subjectKey)).filter(Number.isInteger);
  const owners = new Map<number, number>();
  if (accountIds.length) {
    const ids = sql.join(accountIds.map((i) => sql`${i}`), sql`, `);
    const rows = (await db.execute(sql`select id, person_id from platform_accounts where id in (${ids}) and person_id is not null`)) as unknown as Array<{ id: number; person_id: number }>;
    for (const r of rows) owners.set(Number(r.id), Number(r.person_id));
  }
  const links = new Map<number, string>();
  for (const f of items) {
    if (f.subjectType === "person") links.set(f.id, `/people/${f.subjectKey}`);
    else if (f.subjectType === "team") links.set(f.id, `/teams/${f.subjectKey}`);
    else if (f.subjectType === "account" && owners.has(Number(f.subjectKey))) links.set(f.id, `/people/${owners.get(Number(f.subjectKey))}`);
    else if (f.subjectType === "org") links.set(f.id, "/settings#identity");
  }
  return links;
}

export { peopleSummary };

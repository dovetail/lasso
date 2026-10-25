import { addDays, chunkRange, dayToMs, startOfMonth, toDay, today, type Day } from "@/lib/dates";
import { HttpClient } from "./http";
import { emptyBatch, type NormalisedBatch, type RawPayload, type UsageRecord } from "./types";

export const CURSOR = "cursor";

export interface CursorMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isRemoved: boolean;
}

export interface CursorSpendRow {
  userId: string;
  email: string;
  name: string | null;
  spendCents: number;
  overallSpendCents: number;
  monthlyLimitDollars: number | null;
  hardLimitOverrideDollars: number;
  effectivePerUserLimitDollars: number;
}

export interface CursorSpendPage {
  teamMemberSpend: CursorSpendRow[];
  subscriptionCycleStart: number;
  totalMembers: number;
  totalPages: number;
}

export interface CursorUsageEvent {
  timestamp: string;
  userEmail?: string;
  serviceAccountId?: string;
  model: string;
  kind: string;
  requestsCosts?: number;
  isTokenBasedCall?: boolean;
  isChargeable?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalCents?: number;
  };
  chargedCents?: number;
}

export interface CursorEventsPage {
  usageEvents: CursorUsageEvent[];
  pagination: { numPages: number; currentPage: number; hasNextPage: boolean };
}

export interface CursorDailyUsageRow {
  email: string;
  day?: string;
  date: number;
  isActive?: boolean;
  totalLinesAdded?: number;
  acceptedLinesAdded?: number;
  composerRequests?: number;
  chatRequests?: number;
  agentRequests?: number;
  cmdkUsages?: number;
  totalTabsAccepted?: number;
  mostUsedModel?: string | null;
}

export class CursorClient {
  private http: HttpClient;

  constructor(apiKey: string, baseUrl = "https://api.cursor.com", fetchImpl?: typeof fetch) {
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    // Admin API allows ~20 req/min on most endpoints.
    this.http = new HttpClient(baseUrl, { authorization: `Basic ${auth}` }, 3100, fetchImpl);
  }

  members() {
    return this.http.json<{ teamMembers: CursorMember[] }>("/teams/members");
  }

  async spend(): Promise<CursorSpendPage[]> {
    const pages: CursorSpendPage[] = [];
    for (let page = 1; ; page++) {
      const res = await this.http.json<CursorSpendPage>("/teams/spend", {
        method: "POST",
        body: { page, pageSize: 500 },
      });
      pages.push(res);
      if (page >= (res.totalPages ?? 1)) break;
    }
    return pages;
  }

  async usageEvents(from: Day, toExclusive: Day): Promise<CursorEventsPage[]> {
    const pages: CursorEventsPage[] = [];
    for (let page = 1; ; page++) {
      const res = await this.http.json<CursorEventsPage>("/teams/filtered-usage-events", {
        method: "POST",
        body: { startDate: dayToMs(from), endDate: dayToMs(toExclusive) - 1, page, pageSize: 1000 },
      });
      pages.push(res);
      if (!res.pagination?.hasNextPage) break;
    }
    return pages;
  }

  async dailyUsage(from: Day, toExclusive: Day): Promise<Array<{ data: CursorDailyUsageRow[] }>> {
    const pages: Array<{ data: CursorDailyUsageRow[] }> = [];
    // pageSize counts users, not rows, so an empty page is the only reliable end marker.
    for (let page = 1; page <= 100; page++) {
      const res = await this.http.json<{ data: CursorDailyUsageRow[] }>("/teams/daily-usage-data", {
        method: "POST",
        body: { startDate: dayToMs(from), endDate: dayToMs(toExclusive) - 1, page, pageSize: 500 },
      });
      if (!res.data?.length) break;
      pages.push(res);
    }
    return pages;
  }
}

export async function fetchCursor(client: CursorClient, from: Day, toExclusive: Day): Promise<RawPayload[]> {
  const out: RawPayload[] = [];
  out.push({ connector: CURSOR, kind: "members", rangeStart: null, rangeEnd: null, payload: await client.members() });
  out.push({ connector: CURSOR, kind: "spend", rangeStart: null, rangeEnd: null, payload: await client.spend() });
  for (const [s, e] of chunkRange(from, toExclusive, 7)) {
    out.push({ connector: CURSOR, kind: "usage_events", rangeStart: s, rangeEnd: e, payload: await client.usageEvents(s, e) });
  }
  for (const [s, e] of chunkRange(from, toExclusive, 30)) {
    out.push({ connector: CURSOR, kind: "daily_usage", rangeStart: s, rangeEnd: e, payload: await client.dailyUsage(s, e) });
  }
  return out;
}

const norm = (email: string) => email.trim().toLowerCase();

export function normaliseCursor(raws: RawPayload[]): NormalisedBatch {
  const batch = emptyBatch();
  batch.coverage = [];
  const accounts = new Map<string, { email: string; name: string | null; isRemoved: boolean }>();
  const touch = (email: string, name: string | null = null, isRemoved = false) => {
    const key = norm(email);
    const existing = accounts.get(key);
    if (!existing) accounts.set(key, { email: key, name, isRemoved });
    else if (name && !existing.name) existing.name = name;
    return key;
  };

  for (const raw of raws.filter((r) => r.kind === "members")) {
    const members = (raw.payload as { teamMembers: CursorMember[] }).teamMembers ?? [];
    batch.seatRoster = [];
    for (const m of members) {
      if (!m.email) continue;
      const id = touch(m.email, m.name, m.isRemoved);
      accounts.get(id)!.isRemoved = m.isRemoved;
      if (!m.isRemoved) batch.seatRoster.push({ platform: "cursor", externalId: id, seatType: m.role ?? "member" });
    }
  }

  for (const raw of raws.filter((r) => r.kind === "spend")) {
    for (const page of raw.payload as CursorSpendPage[]) {
      const cycleStart = page.subscriptionCycleStart ? toDay(new Date(page.subscriptionCycleStart)) : startOfMonth(today());
      for (const row of page.teamMemberSpend ?? []) {
        if (!row.email) continue;
        const id = touch(row.email, row.name);
        const limit = row.effectivePerUserLimitDollars > 0 ? row.effectivePerUserLimitDollars : null;
        batch.limits.push({
          platform: "cursor",
          externalId: id,
          limitKind: "on_demand_spend",
          period: "cycle",
          source: row.hardLimitOverrideDollars > 0 ? "user_override" : row.monthlyLimitDollars != null ? "user" : "team",
          limitUsd: limit,
          usedUsd: (row.spendCents ?? 0) / 100,
          cycleStart,
        });
      }
    }
  }

  const usage = new Map<string, UsageRecord>();
  for (const raw of raws.filter((r) => r.kind === "usage_events")) {
    if (raw.rangeStart && raw.rangeEnd)
      batch.coverage.push({ table: "usage", platform: "cursor", from: raw.rangeStart, toExclusive: raw.rangeEnd });
    for (const page of raw.payload as CursorEventsPage[]) {
      for (const ev of page.usageEvents ?? []) {
        const email = ev.userEmail ? norm(ev.userEmail) : ev.serviceAccountId ? `service:${ev.serviceAccountId}` : null;
        if (!email) continue;
        if (ev.userEmail) touch(ev.userEmail);
        else accounts.set(email, accounts.get(email) ?? { email: email, name: ev.serviceAccountId ?? null, isRemoved: false });
        const day = toDay(new Date(Number(ev.timestamp)));
        const model = ev.model || "unknown";
        const key = `${email}|${model}|${day}`;
        const row =
          usage.get(key) ??
          ({
            platform: "cursor",
            externalId: email,
            product: "cursor",
            model,
            day,
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            costIsEstimated: false,
          } satisfies UsageRecord);
        row.requests += 1;
        row.inputTokens += ev.tokenUsage?.inputTokens ?? 0;
        row.outputTokens += ev.tokenUsage?.outputTokens ?? 0;
        row.cacheReadTokens += ev.tokenUsage?.cacheReadTokens ?? 0;
        row.cacheWriteTokens += ev.tokenUsage?.cacheWriteTokens ?? 0;
        row.costUsd += (ev.chargedCents ?? 0) / 100;
        usage.set(key, row);
      }
    }
  }
  batch.usage = [...usage.values()];

  for (const raw of raws.filter((r) => r.kind === "daily_usage")) {
    if (raw.rangeStart && raw.rangeEnd)
      batch.coverage.push({ table: "activity", platform: "cursor", from: raw.rangeStart, toExclusive: raw.rangeEnd });
    for (const page of raw.payload as Array<{ data: CursorDailyUsageRow[] }>) {
      for (const r of page.data ?? []) {
        if (!r.email) continue;
        const id = touch(r.email);
        const messages = (r.composerRequests ?? 0) + (r.chatRequests ?? 0) + (r.agentRequests ?? 0) + (r.cmdkUsages ?? 0);
        const isActive = r.isActive ?? (messages > 0 || (r.totalTabsAccepted ?? 0) > 0);
        batch.activity.push({
          platform: "cursor",
          externalId: id,
          product: "cursor",
          day: r.day ?? toDay(new Date(r.date)),
          isActive,
          sessions: 0,
          messages,
          linesAdded: r.totalLinesAdded ?? 0,
          linesAccepted: r.acceptedLinesAdded ?? 0,
          commits: 0,
          pullRequests: 0,
          mostUsedModel: r.mostUsedModel ?? null,
        });
      }
    }
  }

  batch.accounts = [...accounts.entries()].map(([externalId, a]) => ({
    platform: "cursor" as const,
    externalId,
    email: externalId.startsWith("service:") ? null : a.email,
    name: a.name,
    isRemoved: a.isRemoved,
  }));
  return batch;
}

export function cursorDefaultRange(lastEnd: Day | null, backfillDays: number): [Day, Day] {
  const end = addDays(today(), 1);
  const start = lastEnd ? addDays(lastEnd, -3) : addDays(end, -backfillDays);
  return [start, end];
}

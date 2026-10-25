import type { Product } from "@/db/schema";
import { addDays, chunkRange, eachDay, startOfMonth, startOfWeek, today, type Day } from "@/lib/dates";
import { HttpClient, HttpError } from "./http";
import { emptyBatch, type ActivityRecord, type NormalisedBatch, type RawPayload, type UsageRecord } from "./types";

export const CLAUDE = "claude";

interface Actor {
  user_id: string;
  email?: string | null;
  email_address?: string | null;
  name?: string | null;
  deleted?: boolean;
}

export interface ClaudeUserUsageRow {
  actor: Actor;
  starting_at: string | null;
  product: string | null;
  model: string | null;
  requests: number | null;
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}

export interface ClaudeUserCostRow {
  actor: Actor;
  starting_at: string | null;
  product: string | null;
  model: string | null;
  amount: string;
  requests: number | null;
}

export interface ClaudeUserActivityRow {
  user?: { id: string; email_address: string } | null;
  chat_metrics?: { message_count?: number; distinct_conversation_count?: number | null };
  claude_code_metrics?: {
    core_metrics?: {
      commit_count?: number;
      distinct_session_count?: number | null;
      pull_request_count?: number;
      lines_of_code?: { added_count?: number; removed_count?: number };
    };
    tool_actions?: Record<string, { accepted_count?: number; rejected_count?: number }>;
  };
  cowork_metrics?: { message_count?: number; distinct_session_count?: number | null; action_count?: number };
}

export interface ClaudeSpendSummary {
  actor: Actor;
  amount: string | null;
  currency: string;
  period: "daily" | "weekly" | "monthly" | string;
  period_to_date_spend: string;
  source?: { type: string } | null;
}

export interface ClaudeIncreaseRequest {
  id: string;
  actor: Actor;
  created_at: string;
  status: string;
  resolved_at: string | null;
  spend_summary: ClaudeSpendSummary | null;
}

interface Paged<T> {
  data: T[];
  has_more?: boolean;
  next_page?: string | null;
}

export class ClaudeClient {
  private analytics?: HttpClient;
  private admin?: HttpClient;

  constructor(
    keys: { analyticsKey?: string; adminKey?: string },
    baseUrl = "https://api.anthropic.com",
    fetchImpl?: typeof fetch,
  ) {
    const headers = (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" });
    if (keys.analyticsKey) this.analytics = new HttpClient(baseUrl, headers(keys.analyticsKey), 250, fetchImpl);
    if (keys.adminKey) this.admin = new HttpClient(baseUrl, headers(keys.adminKey), 250, fetchImpl);
  }

  get hasAnalytics() {
    return Boolean(this.analytics);
  }

  get hasAdmin() {
    return Boolean(this.admin);
  }

  private async paged<T>(client: HttpClient, path: string, params: URLSearchParams): Promise<T[]> {
    const out: T[] = [];
    let page: string | null | undefined;
    for (let i = 0; i < 1000; i++) {
      const q = new URLSearchParams(params);
      if (page) q.set("page", page);
      const res = await client.json<Paged<T>>(`${path}?${q}`);
      out.push(...(res.data ?? []));
      page = res.next_page;
      if (!page) break;
    }
    return out;
  }

  private reportParams(from: Day, toExclusive: Day) {
    const q = new URLSearchParams({
      starting_at: `${from}T00:00:00Z`,
      ending_at: `${toExclusive}T00:00:00Z`,
      bucket_width: "1d",
      limit: "1000",
    });
    q.append("group_by[]", "product");
    q.append("group_by[]", "model");
    return q;
  }

  userUsage(from: Day, toExclusive: Day) {
    return this.paged<ClaudeUserUsageRow>(this.analytics!, "/v1/organizations/analytics/user_usage_report", this.reportParams(from, toExclusive));
  }

  userCost(from: Day, toExclusive: Day) {
    return this.paged<ClaudeUserCostRow>(this.analytics!, "/v1/organizations/analytics/user_cost_report", this.reportParams(from, toExclusive));
  }

  /** Per-user activity for one UTC day. Returns null when the day is not yet available. */
  async usersOn(day: Day): Promise<ClaudeUserActivityRow[] | null> {
    try {
      return await this.paged<ClaudeUserActivityRow>(
        this.analytics!,
        "/v1/organizations/analytics/users",
        new URLSearchParams({ date: day, limit: "1000" }),
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) return null;
      throw err;
    }
  }

  effectiveSpendLimits() {
    return this.paged<ClaudeSpendSummary>(this.admin!, "/v1/organizations/spend_limits/effective", new URLSearchParams({ limit: "1000" }));
  }

  increaseRequests() {
    return this.paged<ClaudeIncreaseRequest>(this.admin!, "/v1/organizations/spend_limit_increase_requests", new URLSearchParams({ limit: "1000" }));
  }
}

export async function fetchClaude(client: ClaudeClient, from: Day, toExclusive: Day): Promise<RawPayload[]> {
  const out: RawPayload[] = [];
  if (client.hasAnalytics) {
    // Analytics data starts on 2026-01-01 and report ranges are capped at 31 days.
    const start = from < "2026-01-01" ? "2026-01-01" : from;
    for (const [s, e] of chunkRange(start, toExclusive, 31)) {
      out.push({ connector: CLAUDE, kind: "user_usage", rangeStart: s, rangeEnd: e, payload: await client.userUsage(s, e) });
      out.push({ connector: CLAUDE, kind: "user_cost", rangeStart: s, rangeEnd: e, payload: await client.userCost(s, e) });
    }
    let latestRoster: { day: Day; rows: ClaudeUserActivityRow[] } | null = null;
    for (const day of eachDay(start, toExclusive)) {
      const rows = await client.usersOn(day);
      if (!rows) continue;
      out.push({ connector: CLAUDE, kind: "users", rangeStart: day, rangeEnd: addDays(day, 1), payload: rows });
      latestRoster = { day, rows };
    }
    if (latestRoster) {
      out.push({ connector: CLAUDE, kind: "roster", rangeStart: latestRoster.day, rangeEnd: null, payload: latestRoster.rows });
    }
  }
  if (client.hasAdmin) {
    out.push({ connector: CLAUDE, kind: "spend_limits", rangeStart: today(), rangeEnd: null, payload: await client.effectiveSpendLimits() });
    out.push({ connector: CLAUDE, kind: "increase_requests", rangeStart: null, rangeEnd: null, payload: await client.increaseRequests() });
  }
  return out;
}

export function claudeProduct(p: string | null | undefined): Product {
  switch (p) {
    case "claude_code":
      return "claude_code";
    case "cowork":
      return "cowork";
    case "chat":
      return "chat";
    default:
      return "other";
  }
}

const cents = (s: string | null | undefined) => (s == null ? null : Number(s) / 100);

function cycleStartFor(period: string, day: Day): Day {
  if (period === "daily") return day;
  if (period === "weekly") return startOfWeek(day);
  return startOfMonth(day);
}

export function normaliseClaude(raws: RawPayload[], asOf: Day = today()): NormalisedBatch {
  const batch = emptyBatch();
  batch.coverage = [];
  const accounts = new Map<string, { email: string | null; name: string | null; isRemoved: boolean }>();
  const touch = (a: Actor | { id: string; email_address: string }) => {
    const id = "user_id" in a ? a.user_id : a.id;
    const email = ("email_address" in a ? a.email_address : null) ?? ("email" in a ? a.email : null) ?? null;
    const name = "name" in a ? (a.name ?? null) : null;
    const deleted = "deleted" in a ? Boolean(a.deleted) : false;
    const existing = accounts.get(id);
    if (!existing) accounts.set(id, { email: email?.toLowerCase() ?? null, name, isRemoved: deleted });
    else {
      existing.email ??= email?.toLowerCase() ?? null;
      existing.name ??= name;
    }
    return id;
  };

  const usage = new Map<string, UsageRecord>();
  const row = (id: string, product: Product, model: string, day: Day) => {
    const key = `${id}|${product}|${model}|${day}`;
    let r = usage.get(key);
    if (!r) {
      r = {
        platform: "claude",
        externalId: id,
        product,
        model,
        day,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costIsEstimated: false,
      };
      usage.set(key, r);
    }
    return r;
  };

  for (const raw of raws) {
    if (raw.kind === "user_usage") {
      if (raw.rangeStart && raw.rangeEnd)
        batch.coverage.push({ table: "usage", platform: "claude", from: raw.rangeStart, toExclusive: raw.rangeEnd });
      for (const u of raw.payload as ClaudeUserUsageRow[]) {
        if (!u.starting_at) continue;
        const id = touch(u.actor);
        const r = row(id, claudeProduct(u.product), u.model ?? "unknown", u.starting_at.slice(0, 10));
        r.requests += u.requests ?? 0;
        r.inputTokens += u.uncached_input_tokens ?? 0;
        r.outputTokens += u.output_tokens ?? 0;
        r.cacheReadTokens += u.cache_read_input_tokens ?? 0;
        r.cacheWriteTokens += (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) + (u.cache_creation?.ephemeral_5m_input_tokens ?? 0);
      }
    } else if (raw.kind === "user_cost") {
      for (const c of raw.payload as ClaudeUserCostRow[]) {
        if (!c.starting_at) continue;
        const id = touch(c.actor);
        const r = row(id, claudeProduct(c.product), c.model ?? "unknown", c.starting_at.slice(0, 10));
        r.costUsd += cents(c.amount) ?? 0;
      }
    }
  }
  batch.usage = [...usage.values()];

  for (const raw of raws.filter((r) => r.kind === "users")) {
    const day = raw.rangeStart!;
    batch.coverage.push({ table: "activity", platform: "claude", from: day, toExclusive: addDays(day, 1) });
    for (const u of raw.payload as ClaudeUserActivityRow[]) {
      if (!u.user) continue;
      const id = touch(u.user);
      const base = { platform: "claude" as const, externalId: id, day, commits: 0, pullRequests: 0, linesAdded: 0, linesAccepted: 0, mostUsedModel: null };
      const cc = u.claude_code_metrics?.core_metrics;
      const accepted = Object.values(u.claude_code_metrics?.tool_actions ?? {}).reduce((n, t) => n + (t.accepted_count ?? 0), 0);
      const ccSessions = cc?.distinct_session_count ?? 0;
      const rows: ActivityRecord[] = [
        {
          ...base,
          product: "claude_code",
          isActive: ccSessions > 0,
          sessions: ccSessions,
          messages: accepted,
          linesAdded: cc?.lines_of_code?.added_count ?? 0,
          linesAccepted: cc?.lines_of_code?.added_count ?? 0,
          commits: cc?.commit_count ?? 0,
          pullRequests: cc?.pull_request_count ?? 0,
        },
        {
          ...base,
          product: "cowork",
          isActive: (u.cowork_metrics?.distinct_session_count ?? 0) > 0 || (u.cowork_metrics?.message_count ?? 0) > 0,
          sessions: u.cowork_metrics?.distinct_session_count ?? 0,
          messages: u.cowork_metrics?.message_count ?? 0,
        },
        {
          ...base,
          product: "chat",
          isActive: (u.chat_metrics?.message_count ?? 0) > 0,
          sessions: u.chat_metrics?.distinct_conversation_count ?? 0,
          messages: u.chat_metrics?.message_count ?? 0,
        },
      ];
      batch.activity.push(...rows);
    }
  }

  const roster = raws.filter((r) => r.kind === "roster").at(-1);
  if (roster) {
    batch.seatRoster = (roster.payload as ClaudeUserActivityRow[])
      .filter((u) => u.user)
      .map((u) => ({ platform: "claude" as const, externalId: touch(u.user!), seatType: "member" }));
  }

  for (const raw of raws.filter((r) => r.kind === "spend_limits")) {
    const day = raw.rangeStart ?? asOf;
    for (const s of raw.payload as ClaudeSpendSummary[]) {
      const id = touch(s.actor);
      batch.limits.push({
        platform: "claude",
        externalId: id,
        limitKind: "spend",
        period: s.period,
        source: s.source?.type ?? null,
        limitUsd: cents(s.amount),
        usedUsd: cents(s.period_to_date_spend) ?? 0,
        cycleStart: cycleStartFor(s.period, day),
      });
    }
  }

  for (const raw of raws.filter((r) => r.kind === "increase_requests")) {
    for (const r of raw.payload as ClaudeIncreaseRequest[]) {
      const id = touch(r.actor);
      batch.increaseRequests.push({
        platform: "claude",
        externalId: r.id,
        accountExternalId: id,
        status: r.status,
        requestedAt: r.created_at,
        resolvedAt: r.resolved_at,
        limitUsdAtRequest: cents(r.spend_summary?.amount),
        spendUsdAtRequest: cents(r.spend_summary?.period_to_date_spend),
      });
    }
  }

  batch.accounts = [...accounts.entries()].map(([externalId, a]) => ({
    platform: "claude" as const,
    externalId,
    email: a.email,
    name: a.name,
    isRemoved: a.isRemoved,
  }));
  return batch;
}

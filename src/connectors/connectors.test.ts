import { describe, expect, it } from "vitest";
import { normaliseClaude } from "./claude";
import { parseClaudeCsv } from "./claudeCsv";
import { CursorClient, normaliseCursor } from "./cursor";
import type { RawPayload } from "./types";

describe("normaliseCursor", () => {
  const raws: RawPayload[] = [
    {
      connector: "cursor",
      kind: "members",
      rangeStart: null,
      rangeEnd: null,
      payload: {
        teamMembers: [
          { id: "user_a", email: "Alex@Co.com", name: "Alex", role: "member", isRemoved: false },
          { id: "user_b", email: "sam@co.com", name: "Sam", role: "owner", isRemoved: true },
        ],
      },
    },
    {
      connector: "cursor",
      kind: "spend",
      rangeStart: null,
      rangeEnd: null,
      payload: [
        {
          subscriptionCycleStart: Date.UTC(2026, 9, 5),
          totalPages: 1,
          totalMembers: 1,
          teamMemberSpend: [
            {
              userId: "user_a",
              email: "alex@co.com",
              name: "Alex",
              spendCents: 4550,
              overallSpendCents: 9000,
              monthlyLimitDollars: 50,
              hardLimitOverrideDollars: 0,
              effectivePerUserLimitDollars: 50,
            },
          ],
        },
      ],
    },
    {
      connector: "cursor",
      kind: "usage_events",
      rangeStart: "2026-10-20",
      rangeEnd: "2026-10-27",
      payload: [
        {
          pagination: { numPages: 1, currentPage: 1, hasNextPage: false },
          usageEvents: [
            { timestamp: String(Date.UTC(2026, 9, 21, 3)), userEmail: "alex@co.com", model: "claude-4.5-sonnet", kind: "Usage-based", chargedCents: 120, tokenUsage: { inputTokens: 100, outputTokens: 50 } },
            { timestamp: String(Date.UTC(2026, 9, 21, 9)), userEmail: "ALEX@co.com", model: "claude-4.5-sonnet", kind: "Usage-based", chargedCents: 80, tokenUsage: { inputTokens: 10, outputTokens: 5 } },
            { timestamp: String(Date.UTC(2026, 9, 22, 9)), serviceAccountId: "sa_1", model: "gpt-5", kind: "Usage-based", chargedCents: 10 },
          ],
        },
      ],
    },
    {
      connector: "cursor",
      kind: "daily_usage",
      rangeStart: "2026-10-20",
      rangeEnd: "2026-10-27",
      payload: [{ data: [{ email: "alex@co.com", day: "2026-10-21", date: 0, isActive: true, agentRequests: 4, chatRequests: 1, totalLinesAdded: 300, acceptedLinesAdded: 120 }] }],
    },
  ];

  it("aggregates events per user, model and day", () => {
    const b = normaliseCursor(raws);
    const alex = b.usage.filter((u) => u.externalId === "alex@co.com");
    expect(alex).toHaveLength(1);
    expect(alex[0]).toMatchObject({ day: "2026-10-21", requests: 2, inputTokens: 110, outputTokens: 55, costUsd: 2 });
    expect(b.usage.find((u) => u.externalId === "service:sa_1")?.costUsd).toBeCloseTo(0.1);
  });

  it("captures limits, seats, activity and coverage", () => {
    const b = normaliseCursor(raws);
    expect(b.limits[0]).toMatchObject({ externalId: "alex@co.com", limitUsd: 50, usedUsd: 45.5, cycleStart: "2026-10-05" });
    expect(b.seatRoster?.map((s) => s.externalId)).toEqual(["alex@co.com"]);
    expect(b.accounts.find((a) => a.externalId === "sam@co.com")?.isRemoved).toBe(true);
    expect(b.activity[0]).toMatchObject({ isActive: true, messages: 5, linesAccepted: 120 });
    expect(b.coverage).toEqual([
      { table: "usage", platform: "cursor", from: "2026-10-20", toExclusive: "2026-10-27" },
      { table: "activity", platform: "cursor", from: "2026-10-20", toExclusive: "2026-10-27" },
    ]);
  });
});

describe("normaliseClaude", () => {
  const actor = { type: "user_actor", user_id: "user_1", email: "Jane@Co.com", name: "Jane", deleted: false };
  const raws: RawPayload[] = [
    {
      connector: "claude",
      kind: "user_usage",
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-03",
      payload: [
        { actor, starting_at: "2026-10-01T00:00:00Z", product: "cowork", model: "claude-sonnet-5", requests: 10, uncached_input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 5 } },
        { actor, starting_at: "2026-10-01T00:00:00Z", product: "claude_code", model: "claude-opus-5", requests: 3, uncached_input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 },
      ],
    },
    {
      connector: "claude",
      kind: "user_cost",
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-03",
      payload: [{ actor, starting_at: "2026-10-01T00:00:00Z", product: "cowork", model: "claude-sonnet-5", amount: "250.5", requests: 10 }],
    },
    {
      connector: "claude",
      kind: "users",
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-02",
      payload: [
        {
          user: { id: "user_1", email_address: "jane@co.com" },
          claude_code_metrics: { core_metrics: { distinct_session_count: 2, commit_count: 1, pull_request_count: 1, lines_of_code: { added_count: 40 } } },
          cowork_metrics: { distinct_session_count: 3, message_count: 12 },
          chat_metrics: { message_count: 0 },
        },
      ],
    },
    { connector: "claude", kind: "roster", rangeStart: "2026-10-01", rangeEnd: null, payload: [{ user: { id: "user_1", email_address: "jane@co.com" } }] },
    {
      connector: "claude",
      kind: "spend_limits",
      rangeStart: "2026-10-15",
      rangeEnd: null,
      payload: [{ actor: { user_id: "user_1", email_address: "jane@co.com" }, amount: "50000", currency: "USD", period: "monthly", period_to_date_spend: "41000", source: { type: "seat_tier" } }],
    },
    {
      connector: "claude",
      kind: "increase_requests",
      rangeStart: null,
      rangeEnd: null,
      payload: [{ id: "slir_1", actor: { user_id: "user_1" }, created_at: "2026-10-10T00:00:00Z", status: "pending", resolved_at: null, spend_summary: { amount: "50000", period_to_date_spend: "49000", period: "monthly" } }],
    },
  ];

  it("merges usage and cost by user, product, model and day", () => {
    const b = normaliseClaude(raws);
    const cowork = b.usage.find((u) => u.product === "cowork")!;
    expect(cowork).toMatchObject({ requests: 10, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 5, costUsd: 2.505 });
    expect(b.usage.find((u) => u.product === "claude_code")?.costUsd).toBe(0);
    expect(b.accounts).toEqual([{ platform: "claude", externalId: "user_1", email: "jane@co.com", name: "Jane", isRemoved: false }]);
  });

  it("captures activity per product, limits, and increase requests", () => {
    const b = normaliseClaude(raws);
    expect(b.activity.find((a) => a.product === "cowork")).toMatchObject({ isActive: true, sessions: 3, messages: 12 });
    expect(b.activity.find((a) => a.product === "claude_code")).toMatchObject({ sessions: 2, commits: 1, linesAdded: 40 });
    expect(b.activity.find((a) => a.product === "chat")?.isActive).toBe(false);
    expect(b.limits[0]).toMatchObject({ limitUsd: 500, usedUsd: 410, cycleStart: "2026-10-01", source: "seat_tier" });
    expect(b.increaseRequests[0]).toMatchObject({ accountExternalId: "user_1", limitUsdAtRequest: 500, spendUsdAtRequest: 490 });
    expect(b.seatRoster).toEqual([{ platform: "claude", externalId: "user_1", seatType: "member" }]);
  });
});

describe("parseClaudeCsv", () => {
  it("parses long format", () => {
    const r = parseClaudeCsv(`Email,Date,Product,Model,Cost (USD),Sessions,Messages
jane@co.com,2026-10-01,Cowork,claude-sonnet-5,$3.20,4,40
jane@co.com,2026-10-02,claude_code,claude-opus-5,12.5,6,0`);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(2);
    expect(r.range).toEqual(["2026-10-01", "2026-10-02"]);
    expect(r.batch.usage.find((u) => u.product === "cowork")?.costUsd).toBeCloseTo(3.2);
    expect(r.batch.activity.find((a) => a.product === "cowork")).toMatchObject({ sessions: 4, messages: 40, isActive: true });
    expect(r.batch.accounts[0]).toMatchObject({ externalId: "email:jane@co.com", email: "jane@co.com" });
  });

  it("parses wide format", () => {
    const r = parseClaudeCsv(`email,date,cowork_sessions,cowork_messages,claude_code_sessions,claude_code_commits
a@co.com,10/01/2026,2,10,1,3`);
    expect(r.errors).toEqual([]);
    expect(r.batch.activity.find((a) => a.product === "cowork")).toMatchObject({ sessions: 2, messages: 10 });
    expect(r.batch.activity.find((a) => a.product === "claude_code")).toMatchObject({ sessions: 1, commits: 3 });
  });

  it("rejects files without required columns", () => {
    const r = parseClaudeCsv(`name,cost\nJane,3`);
    expect(r.rowCount).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("CursorClient", () => {
  it("sends basic auth and retries 429", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    let n = 0;
    const fake: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      n++;
      if (n === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
      return Response.json({ teamMembers: [] });
    };
    const client = new CursorClient("key_123", "https://api.cursor.test", fake);
    const res = await client.members();
    expect(res.teamMembers).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("key_123:").toString("base64")}`);
  });
});

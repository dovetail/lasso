import { count } from "drizzle-orm";
import type { GithubSnapshot } from "@/connectors/github";
import type { ActivityRecord, IncreaseRequestRecord, LimitRecord, NormalisedBatch, UsageRecord } from "@/connectors/types";
import type { DB } from "@/db/client";
import { budgets, platformAccounts, syncRuns } from "@/db/schema";
import { refreshDerived } from "@/ingest/sync";
import { writeGithubSnapshot } from "@/ingest/identity";
import { writeBatch } from "@/ingest/writer";
import { addDays, dayOfWeek, eachDay, parseDay, startOfMonth, toDay, today, type Day } from "@/lib/dates";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Alex", "Sam", "Jordan", "Priya", "Mei", "Tom", "Aisha", "Lucas", "Nina", "Omar", "Grace", "Hiro", "Zoe", "Ben", "Leila", "Ravi", "Chloe", "Diego", "Ivy", "Kai", "Maya", "Noah", "Ella", "Finn", "Sara", "Theo", "Ana", "Jack", "Lina", "Max", "Ruby", "Leo", "Isla", "Arjun", "Emma", "Oscar", "Yuki", "Liam", "Nora", "Eli", "Fatima", "Hugo", "Iris", "Jonah", "Kira", "Mila", "Niko", "Olive", "Pablo", "Quinn", "Rosa", "Seb", "Tara", "Uma", "Vik", "Wren", "Xavi", "Yara", "Zach", "Ada"];
const LAST = ["Nguyen", "Smith", "Patel", "Chen", "Garcia", "Kim", "Brown", "Singh", "Martin", "Lopez", "Wilson", "Tanaka", "Khan", "Taylor", "Rossi", "Silva"];
const TEAMS = [
  { slug: "platform", name: "Platform", size: 10 },
  { slug: "web", name: "Web", size: 12 },
  { slug: "mobile", name: "Mobile", size: 8 },
  { slug: "data", name: "Data", size: 9 },
  { slug: "infra", name: "Infrastructure", size: 7 },
  { slug: "design", name: "Design", size: 6 },
  { slug: "growth", name: "Growth", size: 8 },
];

const CURSOR_MODELS: Array<[string, number, number]> = [
  // model, $ per request, avg tokens per request
  ["claude-4.5-sonnet", 0.09, 9000],
  ["gpt-5", 0.06, 7000],
  ["composer-2", 0.02, 6000],
  ["claude-4.5-opus-thinking", 0.35, 14000],
];
const CLAUDE_MODELS: Array<[string, number, number]> = [
  ["claude-sonnet-5", 0.07, 8000],
  ["claude-opus-5", 0.3, 12000],
  ["claude-haiku-5", 0.01, 3000],
];

export async function seedDemoIfEmpty(db: DB) {
  const [row] = await db.select({ n: count() }).from(platformAccounts);
  if ((row?.n ?? 0) > 0) return false;
  await seedDemo(db);
  return true;
}

export async function seedDemo(db: DB, asOf: Day = today()) {
  const rand = rng(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const domain = "example.com";
  const start = addDays(asOf, -95);
  const days = eachDay(start, asOf);

  interface P {
    login: string;
    name: string;
    email: string;
    team: string;
    cursor: boolean;
    claude: boolean;
    intensity: number;
    cursorShare: number;
    trait?: "idle_cursor" | "idle_claude" | "overlap" | "opus_small" | "spike" | "whale" | "limit_hitter" | "fading";
  }

  const peopleList: P[] = [];
  let i = 0;
  for (const t of TEAMS) {
    for (let k = 0; k < t.size; k++, i++) {
      const first = FIRST[i % FIRST.length]!;
      const last = LAST[(i * 7) % LAST.length]!;
      const login = `${first}${last}`.toLowerCase() + (i >= FIRST.length ? i : "");
      const cursor = t.slug !== "design" ? rand() < 0.9 : rand() < 0.3;
      const claude = t.slug === "design" || t.slug === "data" ? true : rand() < 0.55;
      peopleList.push({
        login,
        name: `${first} ${last}`,
        email: `${first}.${last}${i >= FIRST.length ? i : ""}@${domain}`.toLowerCase(),
        team: t.slug,
        cursor: cursor || !claude,
        claude,
        intensity: 0.4 + rand() * 1.6,
        cursorShare: 0.3 + rand() * 0.6,
      });
    }
  }
  const traits: Array<[number, P["trait"]]> = [
    [3, "idle_cursor"],
    [14, "idle_cursor"],
    [40, "idle_claude"],
    [52, "idle_claude"],
    [5, "overlap"],
    [20, "overlap"],
    [33, "overlap"],
    [8, "opus_small"],
    [25, "spike"],
    [31, "whale"],
    [11, "limit_hitter"],
    [27, "limit_hitter"],
  ];
  for (const [idx, trait] of traits) {
    const p = peopleList[idx]!;
    p.trait = trait;
    if (trait === "idle_cursor" || trait === "overlap" || trait === "limit_hitter" || trait === "spike") p.cursor = true;
    if (trait === "idle_claude" || trait === "overlap" || trait === "opus_small") p.claude = true;
  }
  for (const p of peopleList.filter((x) => x.team === "mobile")) p.trait ??= "fading";

  const snapshot: GithubSnapshot = {
    org: "example",
    warnings: [],
    members: peopleList.map((p) => ({ login: p.login, name: p.name, publicEmail: null, verifiedEmails: [p.email], samlEmails: [] })),
    teams: TEAMS.map((t, idx) => ({
      id: 1000 + idx,
      slug: t.slug,
      name: t.name,
      parentSlug: null,
      members: peopleList.filter((p) => p.team === t.slug).map((p) => p.login),
    })),
  };
  await writeGithubSnapshot(db, snapshot);

  const batch: NormalisedBatch = {
    accounts: [],
    usage: [],
    activity: [],
    limits: [],
    increaseRequests: [],
    seatRoster: [],
    coverage: [],
  };

  const usageRow = (platform: "cursor" | "claude", externalId: string, product: UsageRecord["product"], model: string, day: Day, requests: number, perReq: number, tokPerReq: number): UsageRecord => ({
    platform,
    externalId,
    product,
    model,
    day,
    requests,
    inputTokens: Math.round(requests * tokPerReq * 0.8),
    outputTokens: Math.round(requests * tokPerReq * 0.2),
    cacheReadTokens: Math.round(requests * tokPerReq * 2),
    cacheWriteTokens: Math.round(requests * tokPerReq * 0.3),
    costUsd: Math.round(requests * perReq * (0.8 + rand() * 0.4) * 100) / 100,
    costIsEstimated: false,
  });
  const activityRow = (platform: "cursor" | "claude", externalId: string, product: ActivityRecord["product"], day: Day, sessions: number, messages: number): ActivityRecord => ({
    platform,
    externalId,
    product,
    day,
    isActive: sessions + messages > 0,
    sessions,
    messages,
    linesAdded: Math.round(messages * (20 + rand() * 40)),
    linesAccepted: Math.round(messages * (10 + rand() * 25)),
    commits: product === "claude_code" ? Math.round(sessions * rand() * 2) : 0,
    pullRequests: product === "claude_code" ? Math.round(sessions * rand() * 0.5) : 0,
    mostUsedModel: null,
  });

  // Two unmatched accounts: contractors not in GitHub.
  const contractors = ["contractor.one@agency.io", "contractor.two@agency.io"];

  for (const p of peopleList) {
    const cursorId = p.email;
    const claudeId = `user_demo_${p.login}`;
    if (p.cursor) {
      batch.accounts.push({ platform: "cursor", externalId: cursorId, email: p.email, name: p.name });
      batch.seatRoster!.push({ platform: "cursor", externalId: cursorId, seatType: "member" });
    }
    if (p.claude) {
      batch.accounts.push({ platform: "claude", externalId: claudeId, email: p.email, name: p.name });
      batch.seatRoster!.push({ platform: "claude", externalId: claudeId, seatType: "member" });
    }

    for (const [di, day] of days.entries()) {
      const weekend = [0, 6].includes(dayOfWeek(day));
      const growth = 1 + di / days.length;
      if (p.trait === "spike" && day === addDays(asOf, -1)) {
        batch.usage.push(usageRow("cursor", cursorId, "cursor", "claude-4.5-opus-thinking", day, 900, 0.35, 14000));
      }
      let activeChance = weekend ? 0.12 : 0.82;
      if (p.trait === "fading" && di > days.length - 30) activeChance *= 0.25;
      if (rand() > activeChance) continue;
      const load = p.intensity * growth * (0.6 + rand() * 0.8);

      const useCursor = p.cursor && p.trait !== "idle_cursor" && (p.trait === "overlap" ? true : !p.claude || rand() < p.cursorShare);
      const useClaude =
        p.claude && p.trait !== "idle_claude" && (p.trait === "overlap" ? rand() < 0.06 : !p.cursor || !useCursor || rand() < 0.4);

      if (useCursor) {
        let reqs = Math.max(1, Math.round(load * 25));
        if (p.trait === "whale") reqs *= 6;
        if (p.trait === "limit_hitter") reqs *= 3;
        if (p.trait === "spike" && day === addDays(asOf, -1)) reqs *= 25;
        const [m1, c1, t1] = CURSOR_MODELS[0]!;
        const [m2, c2, t2] = pick(CURSOR_MODELS);
        batch.usage.push(usageRow("cursor", cursorId, "cursor", m1, day, Math.ceil(reqs * 0.6), c1, t1));
        if (m2 !== m1) batch.usage.push(usageRow("cursor", cursorId, "cursor", m2, day, Math.ceil(reqs * 0.4), c2, t2));
        batch.activity.push(activityRow("cursor", cursorId, "cursor", day, 0, reqs));
      }
      if (useClaude) {
        const reqs = Math.max(1, Math.round(load * 18));
        const product = p.team === "design" ? "cowork" : rand() < 0.75 ? "claude_code" : pick(["cowork", "chat"] as const);
        let [m, c, t] = pick(CLAUDE_MODELS);
        if (p.trait === "opus_small" && /opus/.test(m)) [m, c, t] = CLAUDE_MODELS.find(([name]) => !/opus/.test(name))!;
        batch.usage.push(usageRow("claude", claudeId, product, m, day, reqs, c, t));
        batch.activity.push(activityRow("claude", claudeId, product, day, Math.max(1, Math.round(reqs / 8)), reqs));
      }
      if (p.trait === "opus_small" && di > days.length - 10 && !weekend) {
        batch.usage.push({ ...usageRow("claude", claudeId, "claude_code", "claude-opus-5", day, 12, 0.05, 900) });
        batch.activity.push(activityRow("claude", claudeId, "claude_code", day, 3, 12));
      }
    }
  }

  for (const c of contractors) {
    batch.accounts.push({ platform: "cursor", externalId: c, email: c, name: null });
    batch.seatRoster!.push({ platform: "cursor", externalId: c, seatType: "member" });
    for (const day of days.slice(-40)) {
      if (rand() < 0.6) batch.usage.push(usageRow("cursor", c, "cursor", "gpt-5", day, 20, 0.06, 7000));
    }
  }

  // Limits: three monthly Cursor cycles and current Claude spend limits.
  const cycles = [startOfMonth(addDays(startOfMonth(asOf), -62)), startOfMonth(addDays(startOfMonth(asOf), -31)), startOfMonth(asOf)];
  const limits: LimitRecord[] = [];
  const spendIn = (platform: "cursor" | "claude", ext: string, from: Day, to: Day) =>
    batch.usage.filter((u) => u.platform === platform && u.externalId === ext && u.day >= from && u.day < to).reduce((a, u) => a + u.costUsd, 0);
  for (const p of peopleList.filter((x) => x.cursor)) {
    const limit = p.trait === "limit_hitter" ? 150 : p.intensity > 1.4 ? 250 : 200;
    for (const [ci, cs] of cycles.entries()) {
      const next = cycles[ci + 1] ?? addDays(asOf, 1);
      const used = Math.max(0, spendIn("cursor", p.email, cs, next) - 20);
      limits.push({ platform: "cursor", externalId: p.email, limitKind: "on_demand_spend", period: "cycle", source: "team", limitUsd: limit, usedUsd: Math.round(used * 100) / 100, cycleStart: cs });
    }
  }
  for (const p of peopleList.filter((x) => x.claude)) {
    const ext = `user_demo_${p.login}`;
    const used = spendIn("claude", ext, startOfMonth(asOf), addDays(asOf, 1));
    limits.push({ platform: "claude", externalId: ext, limitKind: "spend", period: "monthly", source: p.team === "data" ? "rbac_group" : "seat_tier", limitUsd: p.team === "data" ? 400 : 120, usedUsd: Math.round(used * 100) / 100, cycleStart: startOfMonth(asOf) });
  }
  batch.limits = limits;

  const requests: IncreaseRequestRecord[] = [];
  for (const p of peopleList.filter((x) => x.claude && x.trait === "opus_small")) {
    for (const ago of [5, 33]) {
      const at = toDay(new Date(parseDay(asOf).getTime() - ago * 86_400_000));
      requests.push({
        platform: "claude",
        externalId: `slir_demo_${p.login}_${ago}`,
        accountExternalId: `user_demo_${p.login}`,
        status: ago === 5 ? "pending" : "approved",
        requestedAt: `${at}T09:00:00Z`,
        resolvedAt: ago === 5 ? null : `${at}T15:00:00Z`,
        limitUsdAtRequest: 120,
        spendUsdAtRequest: 118,
      });
    }
  }
  batch.increaseRequests = requests;

  await writeBatch(db, batch, { seatStartDefault: start });

  const teams = await db.query.githubTeams.findMany();
  const web = teams.find((t) => t.slug === "web");
  await db.insert(budgets).values([
    { scopeType: "org", scopeId: null, amountUsd: 9000, note: "Org AI usage budget" },
    ...(web ? [{ scopeType: "team" as const, scopeId: web.id, amountUsd: 1200, note: "Web team" }] : []),
  ]);

  await db.insert(syncRuns).values({ connector: "demo", status: "success", finishedAt: new Date(), rowsWritten: batch.usage.length, rangeStart: start, rangeEnd: asOf });
  await refreshDerived(db);
  console.log(`[lasso] demo data seeded: ${peopleList.length} people, ${batch.usage.length} usage rows`);
}

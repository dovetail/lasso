import type { Platform } from "@/db/schema";
import { addDays, startOfWeek, type Day } from "@/lib/dates";
import type { Settings } from "@/lib/settings";
import { cyclesAtLimit, type CycleObservation } from "./limits";
import { CHEAPER_MODEL_COST_RATIO } from "./projection";

export interface FindingDraft {
  ruleId: string;
  subjectType: "person" | "account" | "team" | "org";
  subjectKey: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  monthlyImpactUsd: number | null;
}

export interface FindingsInput {
  asOf: Day;
  settings: Settings;
  githubConfigured: boolean;
  accounts: Array<{
    id: number;
    platform: Platform;
    personId: number | null;
    label: string;
    matchSource: string;
    isRemoved: boolean;
    openSeatStartedOn: Day | null;
  }>;
  people: Array<{ id: number; label: string }>;
  usage: Array<{
    accountId: number;
    personId: number | null;
    platform: Platform;
    model: string;
    day: Day;
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
  activeDays: Array<{ accountId: number; day: Day }>;
  teams: Array<{ id: number; slug: string; name: string; memberPersonIds: number[] }>;
  limitHistory: Array<{ accountId: number; limitKind: string; observations: CycleObservation[] }>;
  increaseRequests: Array<{ accountId: number; requestedAt: Day }>;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function activeAccountDays(input: FindingsInput, from: Day) {
  const set = new Map<number, Set<Day>>();
  const add = (id: number, day: Day) => {
    if (day < from || day >= input.asOf) return;
    const s = set.get(id) ?? new Set<Day>();
    s.add(day);
    set.set(id, s);
  };
  for (const a of input.activeDays) add(a.accountId, a.day);
  for (const u of input.usage) if (u.requests > 0 || u.costUsd > 0) add(u.accountId, u.day);
  return set;
}

export function idleSeats(input: FindingsInput): FindingDraft[] {
  const { idleSeatDays } = input.settings.thresholds;
  const from = addDays(input.asOf, -idleSeatDays);
  const active = activeAccountDays(input, from);
  const out: FindingDraft[] = [];
  for (const a of input.accounts) {
    if (a.isRemoved || !a.openSeatStartedOn || a.openSeatStartedOn > from) continue;
    if (active.get(a.id)?.size) continue;
    const price = input.settings.seatPriceUsd[a.platform];
    out.push({
      ruleId: "idle_seat",
      subjectType: "account",
      subjectKey: String(a.id),
      severity: "warning",
      title: `Idle ${a.platform === "cursor" ? "Cursor" : "Claude"} seat: ${a.label}`,
      detail: `No activity in the last ${idleSeatDays} days on a paid seat. Reclaiming it saves about ${usd(price)}/month.`,
      evidence: { platform: a.platform, seatStartedOn: a.openSeatStartedOn, idleDays: idleSeatDays },
      monthlyImpactUsd: price,
    });
  }
  return out;
}

export function toolOverlap(input: FindingsInput): FindingDraft[] {
  const { overlapDominantShare } = input.settings.thresholds;
  const from = addDays(input.asOf, -30);
  const active = activeAccountDays(input, from);
  const out: FindingDraft[] = [];
  const byPerson = groupBy(
    input.accounts.filter((a) => a.personId != null && a.openSeatStartedOn && !a.isRemoved),
    (a) => a.personId!,
  );
  const personLabel = new Map(input.people.map((p) => [p.id, p.label]));
  for (const [personId, accts] of byPerson) {
    const cursor = accts.filter((a) => a.platform === "cursor");
    const claude = accts.filter((a) => a.platform === "claude");
    if (!cursor.length || !claude.length) continue;
    const days = (list: typeof accts) => new Set(list.flatMap((a) => [...(active.get(a.id) ?? [])])).size;
    const cDays = days(cursor);
    const aDays = days(claude);
    const total = cDays + aDays;
    if (total < 5) continue;
    const dominant = cDays >= aDays ? "cursor" : "claude";
    const share = Math.max(cDays, aDays) / total;
    if (share < overlapDominantShare) continue;
    const under = dominant === "cursor" ? "claude" : "cursor";
    // Zero activity on the minor tool is already reported as an idle seat.
    if ((under === "cursor" ? cDays : aDays) === 0) continue;
    const price = input.settings.seatPriceUsd[under];
    out.push({
      ruleId: "tool_overlap",
      subjectType: "person",
      subjectKey: String(personId),
      severity: "info",
      title: `Paying for both tools, mostly using ${dominant === "cursor" ? "Cursor" : "Claude"}: ${personLabel.get(personId) ?? personId}`,
      detail: `Active ${cDays} days on Cursor and ${aDays} days on Claude in the last 30 days. The ${under === "cursor" ? "Cursor" : "Claude"} seat (${usd(price)}/month) is rarely used.`,
      evidence: { cursorActiveDays: cDays, claudeActiveDays: aDays, dominant },
      monthlyImpactUsd: price,
    });
  }
  return out;
}

export function expensiveModelSimpleWork(input: FindingsInput): FindingDraft[] {
  const t = input.settings.thresholds;
  let pattern: RegExp;
  try {
    pattern = new RegExp(t.expensiveModelPattern, "i");
  } catch {
    return [];
  }
  const from = addDays(input.asOf, -7);
  const rows = input.usage.filter((u) => u.day >= from && u.day < input.asOf && pattern.test(u.model) && u.requests > 0);
  const out: FindingDraft[] = [];
  const label = new Map(input.accounts.map((a) => [a.id, a.label]));
  for (const [accountId, list] of groupBy(rows, (r) => r.accountId)) {
    const requests = list.reduce((a, r) => a + r.requests, 0);
    const tokens = list.reduce((a, r) => a + r.tokens, 0);
    const cost = list.reduce((a, r) => a + r.costUsd, 0);
    const avg = tokens / requests;
    if (requests < t.expensiveModelMinRequests || avg >= t.expensiveModelMaxTokensPerRequest) continue;
    const models = [...new Set(list.map((r) => r.model))];
    const monthly = (cost / 7) * 30 * (1 - CHEAPER_MODEL_COST_RATIO);
    out.push({
      ruleId: "expensive_model_simple_work",
      subjectType: "account",
      subjectKey: String(accountId),
      severity: monthly > 100 ? "warning" : "info",
      title: `High-reasoning models on small requests: ${label.get(accountId) ?? accountId}`,
      detail: `${requests} requests to ${models.join(", ")} in 7 days averaging ${Math.round(avg)} tokens each. A cheaper model would likely do; potential saving about ${usd(monthly)}/month.`,
      evidence: { requests, avgTokensPerRequest: Math.round(avg), models, cost7d: cost },
      monthlyImpactUsd: monthly,
    });
  }
  return out;
}

export function spikes(input: FindingsInput): FindingDraft[] {
  const { spikeZScore, spikeMinUsd } = input.settings.thresholds;
  const out: FindingDraft[] = [];
  const label = new Map(input.people.map((p) => [p.id, p.label]));
  const recentFrom = addDays(input.asOf, -3);
  const baseFrom = addDays(recentFrom, -28);
  const byPerson = groupBy(
    input.usage.filter((u) => u.personId != null),
    (u) => u.personId!,
  );
  for (const [personId, rows] of byPerson) {
    const perDay = new Map<Day, number>();
    for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.costUsd);
    const baseline: number[] = [];
    for (let d = baseFrom; d < recentFrom; d = addDays(d, 1)) baseline.push(perDay.get(d) ?? 0);
    const m = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, baseline.length - 1));
    let worst: { day: Day; cost: number; z: number } | null = null;
    for (let d = recentFrom; d < input.asOf; d = addDays(d, 1)) {
      const cost = perDay.get(d) ?? 0;
      const z = (cost - m) / Math.max(sd, 1);
      if (cost >= spikeMinUsd && z >= spikeZScore && (!worst || z > worst.z)) worst = { day: d, cost, z };
    }
    if (!worst) continue;
    out.push({
      ruleId: "spend_spike",
      subjectType: "person",
      subjectKey: String(personId),
      severity: worst.z >= spikeZScore * 2 ? "warning" : "info",
      title: `Spend spike: ${label.get(personId) ?? personId}`,
      detail: `${usd(worst.cost)} on ${worst.day}, against a 28-day daily average of ${usd(m)} (${worst.z.toFixed(1)}σ).`,
      evidence: { day: worst.day, cost: worst.cost, baselineMean: m, baselineStd: sd, z: worst.z },
      monthlyImpactUsd: null,
    });
  }
  return out;
}

export function decliningAdoption(input: FindingsInput): FindingDraft[] {
  const { adoptionDropShare } = input.settings.thresholds;
  const out: FindingDraft[] = [];
  const thisWeek = startOfWeek(input.asOf);
  const recentFrom = addDays(thisWeek, -28);
  const priorFrom = addDays(thisWeek, -56);
  const personOf = new Map(input.accounts.map((a) => [a.id, a.personId]));
  const activeByPerson = new Map<number, Set<Day>>();
  const add = (accountId: number, day: Day) => {
    const p = personOf.get(accountId);
    if (p == null) return;
    const s = activeByPerson.get(p) ?? new Set();
    s.add(day);
    activeByPerson.set(p, s);
  };
  for (const a of input.activeDays) add(a.accountId, a.day);
  for (const u of input.usage) if (u.requests > 0) add(u.accountId, u.day);

  /** Share of member-days with activity: sensitive to people using the tools less, not just stopping. */
  const share = (members: number[], from: Day, to: Day) => {
    if (!members.length) return 0;
    let activeDays = 0;
    for (const p of members) for (const d of activeByPerson.get(p) ?? []) if (d >= from && d < to) activeDays++;
    return activeDays / (members.length * 28);
  };

  for (const team of input.teams) {
    if (team.memberPersonIds.length < 3) continue;
    const prior = share(team.memberPersonIds, priorFrom, recentFrom);
    const recent = share(team.memberPersonIds, recentFrom, thisWeek);
    if (prior < 0.05) continue;
    const drop = (prior - recent) / prior;
    if (drop < adoptionDropShare) continue;
    out.push({
      ruleId: "declining_adoption",
      subjectType: "team",
      subjectKey: String(team.id),
      severity: drop >= 0.4 ? "warning" : "info",
      title: `Adoption falling in ${team.name}`,
      detail: `Members were active on ${Math.round(recent * 100)}% of days in the last 4 weeks, down from ${Math.round(prior * 100)}% in the 4 weeks before.`,
      evidence: { priorShare: prior, recentShare: recent, members: team.memberPersonIds.length },
      monthlyImpactUsd: null,
    });
  }
  return out;
}

export function concentration(input: FindingsInput): FindingDraft[] {
  const { concentrationShare, concentrationMinTeamUsd } = input.settings.thresholds;
  const from = addDays(input.asOf, -30);
  const costByPerson = new Map<number, number>();
  for (const u of input.usage) {
    if (u.personId == null || u.day < from || u.day >= input.asOf) continue;
    costByPerson.set(u.personId, (costByPerson.get(u.personId) ?? 0) + u.costUsd);
  }
  const label = new Map(input.people.map((p) => [p.id, p.label]));
  const out: FindingDraft[] = [];
  for (const team of input.teams) {
    if (team.memberPersonIds.length < 3) continue;
    const costs = team.memberPersonIds.map((p) => [p, costByPerson.get(p) ?? 0] as const);
    const total = costs.reduce((a, [, c]) => a + c, 0);
    if (total < concentrationMinTeamUsd) continue;
    const [top, topCost] = costs.reduce((a, b) => (b[1] > a[1] ? b : a));
    const share = topCost / total;
    if (share < concentrationShare) continue;
    out.push({
      ruleId: "spend_concentration",
      subjectType: "team",
      subjectKey: String(team.id),
      severity: "info",
      title: `${label.get(top) ?? top} drives ${Math.round(share * 100)}% of ${team.name}'s usage spend`,
      detail: `${usd(topCost)} of ${usd(total)} usage spend in the last 30 days. Worth a look at workflow or model choice.`,
      evidence: { personId: top, personCost: topCost, teamCost: total, share },
      monthlyImpactUsd: null,
    });
  }
  return out;
}

export function unmatchedAccounts(input: FindingsInput): FindingDraft[] {
  if (!input.githubConfigured) return [];
  const list = input.accounts.filter((a) => a.matchSource === "unmatched" && !a.isRemoved && a.openSeatStartedOn);
  if (!list.length) return [];
  return [
    {
      ruleId: "unmatched_accounts",
      subjectType: "org",
      subjectKey: "org",
      severity: list.length > 5 ? "warning" : "info",
      title: `${list.length} platform account${list.length === 1 ? "" : "s"} not linked to a GitHub user`,
      detail: "Their spend can't be attributed to a GitHub team. Add identity overrides in Settings.",
      evidence: { accounts: list.slice(0, 50).map((a) => ({ id: a.id, platform: a.platform, label: a.label })) },
      monthlyImpactUsd: null,
    },
  ];
}

export function limitPressure(input: FindingsInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const label = new Map(input.accounts.map((a) => [a.id, a.label]));
  const platform = new Map(input.accounts.map((a) => [a.id, a.platform]));
  const since = addDays(input.asOf, -90);
  const requests = groupBy(
    input.increaseRequests.filter((r) => r.requestedAt >= since),
    (r) => r.accountId,
  );
  const ids = new Set([...input.limitHistory.map((l) => l.accountId), ...requests.keys()]);
  for (const id of ids) {
    const hits = Math.max(0, ...input.limitHistory.filter((l) => l.accountId === id).map((l) => cyclesAtLimit(l.observations)));
    const reqs = requests.get(id)?.length ?? 0;
    if (hits < 2 && reqs < 2) continue;
    const parts = [];
    if (hits >= 2) parts.push(`hit their limit in ${hits} of the last 3 cycles`);
    if (reqs) parts.push(`asked for ${reqs} limit increase${reqs === 1 ? "" : "s"} in 90 days`);
    out.push({
      ruleId: "repeated_limit_hits",
      subjectType: "account",
      subjectKey: String(id),
      severity: hits >= 3 || reqs >= 3 ? "warning" : "info",
      title: `Keeps hitting ${platform.get(id) === "cursor" ? "Cursor" : "Claude"} limits: ${label.get(id) ?? id}`,
      detail: `${parts.join(" and ")}. Consider raising the limit or reviewing usage.`,
      evidence: { cyclesAtLimit: hits, increaseRequests90d: reqs },
      monthlyImpactUsd: null,
    });
  }
  return out;
}

export const RULES = [
  idleSeats,
  toolOverlap,
  expensiveModelSimpleWork,
  spikes,
  decliningAdoption,
  concentration,
  unmatchedAccounts,
  limitPressure,
];

export function evaluateFindings(input: FindingsInput): FindingDraft[] {
  return RULES.flatMap((rule) => rule(input));
}

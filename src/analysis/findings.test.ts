import { describe, expect, it } from "vitest";
import { addDays, eachDay } from "@/lib/dates";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  concentration,
  decliningAdoption,
  expensiveModelSimpleWork,
  idleSeats,
  limitPressure,
  spikes,
  toolOverlap,
  unmatchedAccounts,
  type FindingsInput,
} from "./findings";

const asOf = "2026-10-26";

function base(overrides: Partial<FindingsInput> = {}): FindingsInput {
  return {
    asOf,
    settings: DEFAULT_SETTINGS,
    githubConfigured: true,
    accounts: [],
    people: [],
    usage: [],
    activeDays: [],
    teams: [],
    limitHistory: [],
    increaseRequests: [],
    ...overrides,
  };
}

const account = (id: number, platform: "cursor" | "claude", personId: number | null, extra: Partial<FindingsInput["accounts"][number]> = {}) => ({
  id,
  platform,
  personId,
  label: `acct${id}`,
  matchSource: "github_verified",
  isRemoved: false,
  openSeatStartedOn: "2026-01-01",
  ...extra,
});

describe("idleSeats", () => {
  it("flags seats with no recent activity", () => {
    const input = base({
      accounts: [account(1, "cursor", 1), account(2, "claude", 2), account(3, "cursor", 3, { openSeatStartedOn: addDays(asOf, -5) })],
      activeDays: [{ accountId: 2, day: addDays(asOf, -3) }],
    });
    const out = idleSeats(input);
    expect(out.map((f) => f.subjectKey)).toEqual(["1"]);
    expect(out[0]!.monthlyImpactUsd).toBe(DEFAULT_SETTINGS.seatPriceUsd.cursor);
  });

  it("treats usage as activity", () => {
    const input = base({
      accounts: [account(1, "claude", 1)],
      usage: [{ accountId: 1, personId: 1, platform: "claude", model: "m", day: addDays(asOf, -2), requests: 3, tokens: 10, costUsd: 1 }],
    });
    expect(idleSeats(input)).toHaveLength(0);
  });
});

describe("toolOverlap", () => {
  it("flags people mostly on one platform", () => {
    const days = eachDay(addDays(asOf, -20), asOf);
    const input = base({
      accounts: [account(1, "cursor", 7), account(2, "claude", 7), account(3, "cursor", 8), account(4, "claude", 8)],
      people: [{ id: 7, label: "Jane" }, { id: 8, label: "Sam" }],
      activeDays: [
        ...days.map((day) => ({ accountId: 1, day })),
        { accountId: 2, day: days[0]! },
        ...days.slice(0, 10).map((day) => ({ accountId: 3, day })),
        ...days.slice(0, 10).map((day) => ({ accountId: 4, day })),
      ],
    });
    const out = toolOverlap(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.subjectKey).toBe("7");
    expect(out[0]!.monthlyImpactUsd).toBe(DEFAULT_SETTINGS.seatPriceUsd.claude);
  });

  it("leaves completely unused seats to the idle seat rule", () => {
    const days = eachDay(addDays(asOf, -20), asOf);
    const input = base({
      accounts: [account(1, "cursor", 7), account(2, "claude", 7)],
      people: [{ id: 7, label: "Jane" }],
      activeDays: days.map((day) => ({ accountId: 1, day })),
    });
    expect(toolOverlap(input)).toHaveLength(0);
  });
});

describe("expensiveModelSimpleWork", () => {
  it("flags many small requests to high-reasoning models", () => {
    const input = base({
      accounts: [account(1, "claude", 1), account(2, "claude", 2)],
      usage: [
        { accountId: 1, personId: 1, platform: "claude", model: "claude-opus-5", day: addDays(asOf, -1), requests: 30, tokens: 30 * 500, costUsd: 20 },
        { accountId: 2, personId: 2, platform: "claude", model: "claude-opus-5", day: addDays(asOf, -1), requests: 30, tokens: 30 * 9000, costUsd: 90 },
        { accountId: 2, personId: 2, platform: "claude", model: "claude-sonnet-5", day: addDays(asOf, -1), requests: 300, tokens: 300, costUsd: 5 },
      ],
    });
    const out = expensiveModelSimpleWork(input);
    expect(out.map((f) => f.subjectKey)).toEqual(["1"]);
  });
});

describe("spikes", () => {
  it("flags a day far above baseline", () => {
    const usage = eachDay(addDays(asOf, -31), asOf).map((day, i) => ({
      accountId: 1,
      personId: 1,
      platform: "cursor" as const,
      model: "m",
      day,
      requests: 1,
      tokens: 1,
      costUsd: day === addDays(asOf, -1) ? 300 : 5 + (i % 3),
    }));
    const out = spikes(base({ usage, people: [{ id: 1, label: "Jane" }] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence.day).toBe(addDays(asOf, -1));
  });

  it("ignores small absolute spikes", () => {
    const usage = [{ accountId: 1, personId: 1, platform: "cursor" as const, model: "m", day: addDays(asOf, -1), requests: 1, tokens: 1, costUsd: 10 }];
    expect(spikes(base({ usage }))).toHaveLength(0);
  });
});

describe("decliningAdoption", () => {
  it("flags teams whose active share drops", () => {
    const members = [1, 2, 3, 4, 5];
    const accounts = members.map((p) => account(p, "cursor", p));
    const priorDays = eachDay(addDays(asOf, -50), addDays(asOf, -36));
    const activeDays = [
      ...members.flatMap((p) => priorDays.map((day) => ({ accountId: p, day }))),
      { accountId: 1, day: addDays(asOf, -10) },
    ];
    const out = decliningAdoption(base({ accounts, activeDays, teams: [{ id: 9, slug: "web", name: "Web", memberPersonIds: members }] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.subjectKey).toBe("9");
  });
});

describe("concentration", () => {
  it("flags one person dominating team spend", () => {
    const usage = [1, 2, 3].map((p) => ({
      accountId: p,
      personId: p,
      platform: "claude" as const,
      model: "m",
      day: addDays(asOf, -2),
      requests: 1,
      tokens: 1,
      costUsd: p === 1 ? 800 : 50,
    }));
    const out = concentration(base({ usage, teams: [{ id: 1, slug: "a", name: "A", memberPersonIds: [1, 2, 3] }] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence.personId).toBe(1);
  });
});

describe("unmatchedAccounts", () => {
  it("only reports when GitHub is configured", () => {
    const accounts = [account(1, "cursor", 1, { matchSource: "unmatched" })];
    expect(unmatchedAccounts(base({ accounts }))).toHaveLength(1);
    expect(unmatchedAccounts(base({ accounts, githubConfigured: false }))).toHaveLength(0);
  });
});

describe("limitPressure", () => {
  it("flags repeated limit hits and increase requests", () => {
    const out = limitPressure(
      base({
        accounts: [account(1, "cursor", 1), account(2, "claude", 2)],
        limitHistory: [
          {
            accountId: 1,
            limitKind: "on_demand_spend",
            observations: [
              { cycleStart: "2026-08-01", usedUsd: 100, limitUsd: 100 },
              { cycleStart: "2026-09-01", usedUsd: 120, limitUsd: 100 },
              { cycleStart: "2026-10-01", usedUsd: 10, limitUsd: 100 },
            ],
          },
        ],
        increaseRequests: [
          { accountId: 2, requestedAt: addDays(asOf, -10) },
          { accountId: 2, requestedAt: addDays(asOf, -40) },
        ],
      }),
    );
    expect(out.map((f) => f.subjectKey).sort()).toEqual(["1", "2"]);
  });
});

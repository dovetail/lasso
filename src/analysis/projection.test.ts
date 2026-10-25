import { describe, expect, it } from "vitest";
import { addDays, eachDay } from "@/lib/dates";
import { baselineRunRate, densify, EMPTY_SCENARIO, forecast, scenarioRunRate, weekdayFactors, type RunRateContext } from "./projection";

const series = (from: string, n: number, f: (i: number, day: string) => number) =>
  eachDay(from, addDays(from, n)).map((day, i) => ({ day, value: f(i, day) }));

describe("forecast", () => {
  it("returns zeros with no history", () => {
    const f = forecast([], "2026-10-01", "2026-10-11");
    expect(f.expected).toBe(0);
    expect(f.daily).toHaveLength(10);
    expect(f.method).toBe("none");
  });

  it("uses the mean for short histories", () => {
    const f = forecast(series("2026-09-26", 5, () => 10), "2026-10-01", "2026-10-11");
    expect(f.method).toBe("mean");
    expect(f.expected).toBeCloseTo(100);
    expect(f.low).toBeLessThan(f.expected);
    expect(f.high).toBeGreaterThan(f.expected);
  });

  it("projects a flat series flat with a tight band", () => {
    const f = forecast(series("2026-08-01", 56, () => 20), "2026-09-26", "2026-10-26");
    expect(f.method).toBe("trend+seasonality");
    expect(f.expected).toBeCloseTo(600, 0);
    expect(f.high - f.low).toBeLessThan(1);
  });

  it("follows an upward trend, damped", () => {
    const f = forecast(series("2026-08-01", 56, (i) => 10 + i), "2026-09-26", "2026-10-06");
    const lastValue = 10 + 55;
    expect(f.daily[0]!.value).toBeGreaterThan(lastValue);
    expect(f.daily[9]!.value).toBeLessThan(lastValue + 10);
  });

  it("captures weekday seasonality", () => {
    const weekdayHeavy = series("2026-08-03", 56, (_, day) => ([0, 6].includes(new Date(day).getUTCDay()) ? 2 : 30));
    const f = forecast(weekdayHeavy, "2026-09-28", "2026-10-05");
    const sat = f.daily.find((p) => new Date(p.day).getUTCDay() === 6)!;
    const wed = f.daily.find((p) => new Date(p.day).getUTCDay() === 3)!;
    expect(wed.value).toBeGreaterThan(sat.value * 3);
  });

  it("never forecasts negative spend", () => {
    const f = forecast(series("2026-08-01", 56, (i) => Math.max(0, 100 - i * 3)), "2026-09-26", "2026-11-26");
    expect(f.daily.every((p) => p.value >= 0)).toBe(true);
    expect(f.low).toBeGreaterThanOrEqual(0);
  });
});

describe("weekdayFactors", () => {
  it("is all ones for zero history", () => {
    expect(weekdayFactors(series("2026-08-01", 14, () => 0))).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("densify", () => {
  it("fills gaps with zero", () => {
    const out = densify([{ day: "2026-10-02", value: 5 }], "2026-10-01", "2026-10-04");
    expect(out.map((p) => p.value)).toEqual([0, 5, 0]);
  });
});

describe("scenarios", () => {
  const ctx: RunRateContext = {
    seatPrice: { cursor: 40, claude: 30 },
    seats: { cursor: 10, claude: 10 },
    usage30: { cursor: 1000, claude: 2000 },
    activeUsers30: { cursor: 10, claude: 10 },
    idleSeats: { cursor: 2, claude: 3 },
    expensiveModelCost30: 500,
  };

  it("matches the baseline with no changes", () => {
    expect(scenarioRunRate(ctx, EMPTY_SCENARIO)).toEqual(baselineRunRate(ctx));
  });

  it("moves people between platforms with per-user usage", () => {
    const r = scenarioRunRate(ctx, { ...EMPTY_SCENARIO, moveClaudeToCursor: 5 });
    expect(r.seatCost).toBe(15 * 40 + 5 * 30);
    expect(r.usageCost).toBe(1000 + 5 * 100 + 2000 - 5 * 200);
  });

  it("removes idle seats and shifts expensive usage", () => {
    const r = scenarioRunRate(ctx, { ...EMPTY_SCENARIO, removeIdleSeats: true, shiftExpensiveShare: 1 });
    expect(r.seatCost).toBe(8 * 40 + 7 * 30);
    expect(r.usageCost).toBeCloseTo(3000 - 500 * 0.8);
  });
});

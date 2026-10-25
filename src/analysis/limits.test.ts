import { describe, expect, it } from "vitest";
import { crossedThresholds, cycleEndExclusive, cyclesAtLimit, limitStatus, projectedAtCycleEnd } from "./limits";

describe("limitStatus", () => {
  it("classifies usage against a limit", () => {
    expect(limitStatus(10, null, 0.8)).toBe("none");
    expect(limitStatus(10, 0, 0.8)).toBe("none");
    expect(limitStatus(10, 100, 0.8)).toBe("ok");
    expect(limitStatus(80, 100, 0.8)).toBe("near");
    expect(limitStatus(100, 100, 0.8)).toBe("at_or_over");
    expect(limitStatus(150, 100, 0.8)).toBe("at_or_over");
  });
});

describe("cycles", () => {
  it("computes cycle ends", () => {
    expect(cycleEndExclusive("monthly", "2026-10-01")).toBe("2026-11-01");
    expect(cycleEndExclusive("cycle", "2026-10-15")).toBe("2026-11-15");
    expect(cycleEndExclusive("weekly", "2026-10-19")).toBe("2026-10-26");
    expect(cycleEndExclusive("daily", "2026-10-19")).toBe("2026-10-20");
  });

  it("projects spend linearly to cycle end", () => {
    expect(projectedAtCycleEnd(50, "2026-10-01", "2026-10-31", "2026-10-15")).toBeCloseTo(100);
  });

  it("counts recent cycles at the limit", () => {
    const obs = [
      { cycleStart: "2026-07-01", usedUsd: 200, limitUsd: 100 },
      { cycleStart: "2026-08-01", usedUsd: 100, limitUsd: 100 },
      { cycleStart: "2026-09-01", usedUsd: 50, limitUsd: 100 },
      { cycleStart: "2026-10-01", usedUsd: 120, limitUsd: 100 },
    ];
    expect(cyclesAtLimit(obs)).toBe(2);
  });

  it("reports crossed thresholds", () => {
    expect(crossedThresholds(50, 100, 0.8)).toEqual([]);
    expect(crossedThresholds(85, 100, 0.8)).toEqual([0.8]);
    expect(crossedThresholds(100, 100, 0.8)).toEqual([0.8, 1]);
  });
});

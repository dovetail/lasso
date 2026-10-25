import { addDays, daysBetween, parseDay, toDay, type Day } from "@/lib/dates";

export type LimitStatus = "none" | "ok" | "near" | "at_or_over";

export function limitStatus(usedUsd: number, limitUsd: number | null, nearRatio: number): LimitStatus {
  if (limitUsd == null || limitUsd <= 0) return "none";
  const ratio = usedUsd / limitUsd;
  if (ratio >= 1) return "at_or_over";
  if (ratio >= nearRatio) return "near";
  return "ok";
}

export function cycleEndExclusive(period: string, cycleStart: Day): Day {
  if (period === "daily") return addDays(cycleStart, 1);
  if (period === "weekly") return addDays(cycleStart, 7);
  const d = parseDay(cycleStart);
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())));
}

/** Linear burn-rate projection of spend at cycle end. */
export function projectedAtCycleEnd(usedUsd: number, cycleStart: Day, cycleEnd: Day, asOf: Day): number {
  const total = Math.max(1, daysBetween(cycleStart, cycleEnd));
  const elapsed = Math.min(total, Math.max(1, daysBetween(cycleStart, asOf) + 1));
  return (usedUsd / elapsed) * total;
}

export interface CycleObservation {
  cycleStart: Day;
  usedUsd: number;
  limitUsd: number | null;
}

/** Number of the most recent `window` cycles in which the limit was reached. */
export function cyclesAtLimit(observations: CycleObservation[], window = 3): number {
  return [...observations]
    .sort((a, b) => (a.cycleStart < b.cycleStart ? 1 : -1))
    .slice(0, window)
    .filter((o) => o.limitUsd != null && o.limitUsd > 0 && o.usedUsd >= o.limitUsd).length;
}

export function crossedThresholds(usedUsd: number, limitUsd: number | null, nearRatio: number): number[] {
  if (limitUsd == null || limitUsd <= 0) return [];
  const ratio = usedUsd / limitUsd;
  const out: number[] = [];
  if (ratio >= nearRatio) out.push(nearRatio);
  if (ratio >= 1) out.push(1);
  return out;
}

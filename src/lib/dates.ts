const DAY_MS = 86_400_000;

export type Day = string;

export function toDay(d: Date): Day {
  return d.toISOString().slice(0, 10);
}

export function parseDay(day: Day): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function today(): Day {
  return toDay(new Date());
}

export function addDays(day: Day, n: number): Day {
  return toDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

export function eachDay(from: Day, toExclusive: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonthExclusive(day: Day): Day {
  const d = parseDay(startOfMonth(day));
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

export function startOfQuarter(day: Day): Day {
  const d = parseDay(day);
  const q = Math.floor(d.getUTCMonth() / 3) * 3;
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), q, 1)));
}

export function endOfQuarterExclusive(day: Day): Day {
  const d = parseDay(startOfQuarter(day));
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1)));
}

export function endOfYearExclusive(day: Day): Day {
  return `${Number(day.slice(0, 4)) + 1}-01-01`;
}

export function startOfWeek(day: Day): Day {
  const dow = (parseDay(day).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export function dayOfWeek(day: Day): number {
  return parseDay(day).getUTCDay();
}

/** Split [from, toExclusive) into windows of at most `size` days. */
export function chunkRange(from: Day, toExclusive: Day, size: number): Array<[Day, Day]> {
  const out: Array<[Day, Day]> = [];
  for (let s = from; s < toExclusive; ) {
    const e = addDays(s, size) < toExclusive ? addDays(s, size) : toExclusive;
    out.push([s, e]);
    s = e;
  }
  return out;
}

export function dayToMs(day: Day): number {
  return parseDay(day).getTime();
}

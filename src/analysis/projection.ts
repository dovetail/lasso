import { addDays, dayOfWeek, daysBetween, eachDay, type Day } from "@/lib/dates";

export interface DailyPoint {
  day: Day;
  value: number;
}

export interface Forecast {
  /** Sum of forecast values over [from, toExclusive). */
  expected: number;
  /** ~80% interval on the sum. */
  low: number;
  high: number;
  daily: DailyPoint[];
  method: "trend+seasonality" | "mean" | "none";
  historyDays: number;
}

const Z80 = 1.2816;
const TREND_DAMPING = 0.5;

/** Fill missing days with zero across [from, toExclusive). */
export function densify(points: DailyPoint[], from: Day, toExclusive: Day): DailyPoint[] {
  const m = new Map(points.map((p) => [p.day, p.value]));
  return eachDay(from, toExclusive).map((day) => ({ day, value: m.get(day) ?? 0 }));
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Day-of-week multipliers, measured against a centred 7-day moving average so
 * a trend isn't mistaken for seasonality. Shrunk toward 1 when there are few
 * observations, then normalised to average 1.
 */
export function weekdayFactors(history: DailyPoint[]): number[] {
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (let i = 3; i < history.length - 3; i++) {
    const ma = mean(history.slice(i - 3, i + 4).map((p) => p.value));
    if (ma <= 0) continue;
    const d = dayOfWeek(history[i]!.day);
    sums[d] += history[i]!.value / ma;
    counts[d]++;
  }
  const raw = sums.map((s, d) => (counts[d] ? (counts[d] * (s / counts[d]) + 2) / (counts[d] + 2) : 1));
  const avg = mean(raw);
  return avg > 0 ? raw.map((f) => f / avg) : Array(7).fill(1);
}

function linearFit(ys: number[]) {
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

/**
 * Forecast a daily series over [from, toExclusive) from history that ends the
 * day before `from`. Trailing linear trend (damped) on a deseasonalised
 * series, re-seasonalised by weekday. Transparent by design.
 */
export function forecast(history: DailyPoint[], from: Day, toExclusive: Day): Forecast {
  const horizon = Math.max(0, daysBetween(from, toExclusive));
  const days = eachDay(from, toExclusive);
  const nonZeroSpan = history.findIndex((p) => p.value > 0);
  const hist = nonZeroSpan >= 0 ? history.slice(nonZeroSpan) : [];

  if (!horizon) return { expected: 0, low: 0, high: 0, daily: [], method: "none", historyDays: hist.length };
  if (hist.length === 0) {
    return { expected: 0, low: 0, high: 0, daily: days.map((day) => ({ day, value: 0 })), method: "none", historyDays: 0 };
  }

  if (hist.length < 7) {
    const m = mean(hist.map((p) => p.value));
    const expected = m * horizon;
    return {
      expected,
      low: expected * 0.7,
      high: expected * 1.3,
      daily: days.map((day) => ({ day, value: m })),
      method: "mean",
      historyDays: hist.length,
    };
  }

  const factors = weekdayFactors(hist);
  const window = hist.slice(-28);
  const deseason = window.map((p) => p.value / factors[dayOfWeek(p.day)]!);
  const { slope, intercept } = linearFit(deseason);
  const level = intercept + slope * (deseason.length - 1);

  const residuals = window.map((p, i) => p.value - Math.max(0, intercept + slope * i) * factors[dayOfWeek(p.day)]!);
  const sigma = std(residuals);

  const daily = days.map((day, i) => ({
    day,
    value: Math.max(0, level + slope * TREND_DAMPING * (i + 1)) * factors[dayOfWeek(day)]!,
  }));
  const expected = daily.reduce((a, p) => a + p.value, 0);
  const spread = Z80 * sigma * Math.sqrt(horizon);
  return {
    expected,
    low: Math.max(0, expected - spread),
    high: expected + spread,
    daily,
    method: "trend+seasonality",
    historyDays: hist.length,
  };
}

export interface ScenarioParams {
  /** People added (positive) or removed (negative), split by platform. */
  addCursorSeats: number;
  addClaudeSeats: number;
  /** Move N people from Claude to Cursor (negative moves Cursor to Claude). */
  moveClaudeToCursor: number;
  removeIdleSeats: boolean;
  /** Share (0-1) of expensive-model usage cost shifted to cheaper models. */
  shiftExpensiveShare: number;
}

export interface RunRateContext {
  seatPrice: { cursor: number; claude: number };
  seats: { cursor: number; claude: number };
  /** Usage cost over the last 30 days. */
  usage30: { cursor: number; claude: number };
  /** People with any usage in the last 30 days, per platform. */
  activeUsers30: { cursor: number; claude: number };
  idleSeats: { cursor: number; claude: number };
  expensiveModelCost30: number;
}

export interface RunRate {
  seatCost: number;
  usageCost: number;
  total: number;
}

/** Cheaper models are typically ~5x cheaper than high-reasoning ones. */
export const CHEAPER_MODEL_COST_RATIO = 0.2;

export function baselineRunRate(ctx: RunRateContext): RunRate {
  const seatCost = ctx.seats.cursor * ctx.seatPrice.cursor + ctx.seats.claude * ctx.seatPrice.claude;
  const usageCost = ctx.usage30.cursor + ctx.usage30.claude;
  return { seatCost, usageCost, total: seatCost + usageCost };
}

export function scenarioRunRate(ctx: RunRateContext, p: ScenarioParams): RunRate {
  const perUser = (platform: "cursor" | "claude") =>
    ctx.activeUsers30[platform] ? ctx.usage30[platform] / ctx.activeUsers30[platform] : 0;

  let cursorSeats = ctx.seats.cursor + p.addCursorSeats + p.moveClaudeToCursor;
  let claudeSeats = ctx.seats.claude + p.addClaudeSeats - p.moveClaudeToCursor;
  if (p.removeIdleSeats) {
    cursorSeats -= ctx.idleSeats.cursor;
    claudeSeats -= ctx.idleSeats.claude;
  }
  cursorSeats = Math.max(0, cursorSeats);
  claudeSeats = Math.max(0, claudeSeats);

  let usageCursor = ctx.usage30.cursor + (p.addCursorSeats + p.moveClaudeToCursor) * perUser("cursor");
  let usageClaude = ctx.usage30.claude + (p.addClaudeSeats - p.moveClaudeToCursor) * perUser("claude");
  usageCursor = Math.max(0, usageCursor);
  usageClaude = Math.max(0, usageClaude);

  const shift = Math.min(1, Math.max(0, p.shiftExpensiveShare));
  const expensiveSaving = ctx.expensiveModelCost30 * shift * (1 - CHEAPER_MODEL_COST_RATIO);

  const seatCost = cursorSeats * ctx.seatPrice.cursor + claudeSeats * ctx.seatPrice.claude;
  const usageCost = Math.max(0, usageCursor + usageClaude - expensiveSaving);
  return { seatCost, usageCost, total: seatCost + usageCost };
}

export const EMPTY_SCENARIO: ScenarioParams = {
  addCursorSeats: 0,
  addClaudeSeats: 0,
  moveClaudeToCursor: 0,
  removeIdleSeats: false,
  shiftExpensiveShare: 0,
};

export function lastNDays(asOf: Day, n: number): [Day, Day] {
  return [addDays(asOf, -n), asOf];
}

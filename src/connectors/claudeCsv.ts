import Papa from "papaparse";
import type { Product } from "@/db/schema";
import { addDays, type Day } from "@/lib/dates";
import { claudeProduct } from "./claude";
import { emptyBatch, type ActivityRecord, type NormalisedBatch, type UsageRecord } from "./types";

export const CLAUDE_CSV = "claude-csv";

/**
 * Accepts the per-member export from Claude Team admin analytics, or any CSV
 * using these columns. Long format: one row per member/day/product.
 * Wide format: product-prefixed columns such as `cowork_sessions`.
 */
const ALIASES: Record<string, string[]> = {
  email: ["email", "user_email", "member_email", "email_address", "user"],
  name: ["name", "member_name", "user_name", "full_name"],
  day: ["date", "day", "usage_date", "activity_date"],
  product: ["product", "surface", "app"],
  model: ["model"],
  requests: ["requests", "request_count"],
  inputTokens: ["input_tokens", "uncached_input_tokens"],
  outputTokens: ["output_tokens"],
  totalTokens: ["total_tokens", "tokens"],
  costUsd: ["cost_usd", "cost", "spend_usd", "spend", "amount_usd"],
  sessions: ["sessions", "session_count", "distinct_session_count"],
  messages: ["messages", "message_count"],
  linesAdded: ["lines_added", "lines_of_code_added"],
  commits: ["commits", "commit_count"],
  pullRequests: ["pull_requests", "pull_request_count", "prs"],
};

const WIDE_PRODUCTS: Array<[string, Product]> = [
  ["claude_code", "claude_code"],
  ["cowork", "cowork"],
  ["chat", "chat"],
];

export interface CsvParseResult {
  batch: NormalisedBatch;
  rowCount: number;
  errors: string[];
  range: [Day, Day] | null;
}

const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDayValue(v: string): Day | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function parseClaudeCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: normaliseHeader,
  });
  const errors = parsed.errors.slice(0, 10).map((e) => `Row ${e.row ?? "?"}: ${e.message}`);
  const headers = parsed.meta.fields ?? [];
  const col = (field: string) => ALIASES[field]!.find((a) => headers.includes(a));

  const emailCol = col("email");
  const dayCol = col("day");
  if (!emailCol) errors.unshift(`Missing an email column (one of: ${ALIASES.email!.join(", ")}).`);
  if (!dayCol) errors.unshift(`Missing a date column (one of: ${ALIASES.day!.join(", ")}).`);
  const batch = emptyBatch();
  if (!emailCol || !dayCol) return { batch, rowCount: 0, errors, range: null };

  const accounts = new Map<string, string | null>();
  const usage = new Map<string, UsageRecord>();
  const activity = new Map<string, ActivityRecord>();
  const products = new Set<Product>();
  let min: Day | null = null;
  let max: Day | null = null;

  const get = (row: Record<string, string>, field: string, prefix = "") => {
    if (prefix) {
      const names = ALIASES[field]!.map((a) => `${prefix}_${a}`);
      const h = names.find((n) => headers.includes(n));
      return h ? row[h] : undefined;
    }
    const c = col(field);
    return c ? row[c] : undefined;
  };

  const add = (row: Record<string, string>, externalId: string, day: Day, product: Product, prefix: string) => {
    products.add(product);
    const model = (!prefix && get(row, "model")) || "unknown";
    const cost = num(get(row, "costUsd", prefix));
    const input = num(get(row, "inputTokens", prefix));
    const output = num(get(row, "outputTokens", prefix));
    const total = num(get(row, "totalTokens", prefix));
    const requests = num(get(row, "requests", prefix));
    if (cost || input || output || total || requests) {
      const key = `${externalId}|${product}|${model}|${day}`;
      const u = usage.get(key) ?? {
        platform: "claude" as const,
        externalId,
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
      u.requests += requests;
      u.inputTokens += input || (total && !output ? total : 0);
      u.outputTokens += output;
      u.costUsd += cost;
      usage.set(key, u);
    }
    const sessions = num(get(row, "sessions", prefix));
    const messages = num(get(row, "messages", prefix));
    const key = `${externalId}|${product}|${day}`;
    const a = activity.get(key) ?? {
      platform: "claude" as const,
      externalId,
      product,
      day,
      isActive: false,
      sessions: 0,
      messages: 0,
      linesAdded: 0,
      linesAccepted: 0,
      commits: 0,
      pullRequests: 0,
      mostUsedModel: null,
    };
    a.sessions += sessions;
    a.messages += messages;
    a.linesAdded += num(get(row, "linesAdded", prefix));
    a.linesAccepted = a.linesAdded;
    a.commits += num(get(row, "commits", prefix));
    a.pullRequests += num(get(row, "pullRequests", prefix));
    a.isActive = a.isActive || sessions > 0 || messages > 0 || cost > 0 || requests > 0;
    activity.set(key, a);
  };

  const wide = WIDE_PRODUCTS.filter(([p]) => headers.some((h) => h.startsWith(`${p}_`)));
  let rowCount = 0;
  for (const [i, row] of parsed.data.entries()) {
    const email = row[emailCol]?.trim().toLowerCase();
    const day = row[dayCol] ? parseDayValue(row[dayCol]!) : null;
    if (!email || !day) {
      errors.push(`Row ${i + 2}: missing email or unparseable date.`);
      continue;
    }
    rowCount++;
    const externalId = `email:${email}`;
    accounts.set(externalId, get(row, "name")?.trim() || accounts.get(externalId) || null);
    if (!min || day < min) min = day;
    if (!max || day > max) max = day;

    if (wide.length) {
      for (const [prefix, product] of wide) add(row, externalId, day, product, prefix);
    } else {
      add(row, externalId, day, claudeProduct(get(row, "product")?.trim().toLowerCase().replace(/\s+/g, "_")), "");
    }
  }

  batch.accounts = [...accounts.entries()].map(([externalId, name]) => ({
    platform: "claude" as const,
    externalId,
    email: externalId.slice("email:".length),
    name,
  }));
  batch.usage = [...usage.values()];
  batch.activity = [...activity.values()];
  if (min && max) {
    const to = addDays(max, 1);
    batch.coverage = [
      { table: "usage", platform: "claude", products: [...products], from: min, toExclusive: to },
      { table: "activity", platform: "claude", products: [...products], from: min, toExclusive: to },
    ];
  }
  return { batch, rowCount, errors, range: min && max ? [min, max] : null };
}

export const CSV_TEMPLATE = `email,name,date,product,model,requests,input_tokens,output_tokens,cost_usd,sessions,messages
jane@example.com,Jane Smith,2026-10-01,cowork,claude-sonnet-5,42,120000,30000,3.20,4,40
jane@example.com,Jane Smith,2026-10-01,claude_code,claude-opus-5,80,500000,90000,12.50,6,0
`;

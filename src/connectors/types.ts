import type { Platform, Product } from "@/db/schema";
import type { Day } from "@/lib/dates";

/** Normalised shapes that connectors produce and the writer persists. */

export interface AccountRecord {
  platform: Platform;
  externalId: string;
  email: string | null;
  name: string | null;
  isRemoved?: boolean;
}

export interface UsageRecord {
  platform: Platform;
  externalId: string;
  product: Product;
  model: string;
  day: Day;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  costIsEstimated: boolean;
}

export interface ActivityRecord {
  platform: Platform;
  externalId: string;
  product: Product;
  day: Day;
  isActive: boolean;
  sessions: number;
  messages: number;
  linesAdded: number;
  linesAccepted: number;
  commits: number;
  pullRequests: number;
  mostUsedModel: string | null;
}

export interface LimitRecord {
  platform: Platform;
  externalId: string;
  limitKind: string;
  period: string;
  source: string | null;
  limitUsd: number | null;
  usedUsd: number;
  cycleStart: Day;
}

export interface IncreaseRequestRecord {
  platform: Platform;
  externalId: string;
  accountExternalId: string;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  limitUsdAtRequest: number | null;
  spendUsdAtRequest: number | null;
}

export interface SeatRosterRecord {
  platform: Platform;
  externalId: string;
  seatType: string;
}

/** A day range a batch fully covers; existing facts in it are replaced. */
export interface Coverage {
  table: "usage" | "activity";
  platform: Platform;
  products?: Product[];
  from: Day;
  toExclusive: Day;
}

export interface RawPayload {
  connector: string;
  kind: string;
  rangeStart: Day | null;
  rangeEnd: Day | null;
  payload: unknown;
}

export interface NormalisedBatch {
  coverage?: Coverage[];
  accounts: AccountRecord[];
  usage: UsageRecord[];
  activity: ActivityRecord[];
  limits: LimitRecord[];
  increaseRequests: IncreaseRequestRecord[];
  /** When present, the full set of current seats for the platform; others are closed. */
  seatRoster?: SeatRosterRecord[];
}

export function emptyBatch(): NormalisedBatch {
  return { accounts: [], usage: [], activity: [], limits: [], increaseRequests: [] };
}

export function mergeBatches(...batches: NormalisedBatch[]): NormalisedBatch {
  const out = emptyBatch();
  for (const b of batches) {
    out.accounts.push(...b.accounts);
    out.usage.push(...b.usage);
    out.activity.push(...b.activity);
    out.limits.push(...b.limits);
    out.increaseRequests.push(...b.increaseRequests);
    if (b.coverage) out.coverage = [...(out.coverage ?? []), ...b.coverage];
    if (b.seatRoster) out.seatRoster = [...(out.seatRoster ?? []), ...b.seatRoster];
  }
  return out;
}

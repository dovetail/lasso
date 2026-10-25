import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const PLATFORMS = ["cursor", "claude"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PRODUCTS = ["cursor", "claude_code", "cowork", "chat", "other"] as const;
export type Product = (typeof PRODUCTS)[number];

export const MATCH_SOURCES = ["manual", "github_verified", "github_saml", "github_public", "unmatched"] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const money = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });

// Identity

export const people = pgTable(
  "people",
  {
    id: serial("id").primaryKey(),
    githubLogin: text("github_login"),
    displayName: text("display_name"),
    primaryEmail: text("primary_email"),
    ...timestamps,
  },
  (t) => [uniqueIndex("people_github_login_uq").on(t.githubLogin)],
);

export const personEmails = pgTable(
  "person_emails",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    source: text("source").$type<MatchSource>().notNull(),
  },
  (t) => [uniqueIndex("person_emails_email_uq").on(t.email)],
);

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    email: text("email"),
    name: text("name"),
    personId: integer("person_id").references(() => people.id, { onDelete: "set null" }),
    matchSource: text("match_source").$type<MatchSource>().notNull().default("unmatched"),
    isRemoved: boolean("is_removed").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("platform_accounts_platform_ext_uq").on(t.platform, t.externalId),
    index("platform_accounts_email_idx").on(t.email),
    index("platform_accounts_person_idx").on(t.personId),
  ],
);

export const githubTeams = pgTable(
  "github_teams",
  {
    id: serial("id").primaryKey(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parentSlug: text("parent_slug"),
    ...timestamps,
  },
  (t) => [uniqueIndex("github_teams_github_id_uq").on(t.githubId)],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => githubTeams.id, { onDelete: "cascade" }),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
  },
  (t) => [
    uniqueIndex("team_memberships_open_uq")
      .on(t.personId, t.teamId)
      .where(sql`${t.endedOn} is null`),
  ],
);

export const identityOverrides = pgTable(
  "identity_overrides",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    githubLogin: text("github_login").notNull(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("identity_overrides_email_uq").on(t.email)],
);

// Ingest

export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: serial("id").primaryKey(),
    connector: text("connector").notNull(),
    kind: text("kind").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    rangeStart: date("range_start"),
    rangeEnd: date("range_end"),
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("raw_payloads_connector_kind_idx").on(t.connector, t.kind, t.fetchedAt)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    connector: text("connector").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").$type<"running" | "success" | "error">().notNull().default("running"),
    rowsWritten: integer("rows_written").notNull().default(0),
    rangeStart: date("range_start"),
    rangeEnd: date("range_end"),
    error: text("error"),
  },
  (t) => [index("sync_runs_connector_idx").on(t.connector, t.startedAt)],
);

// Facts

export const usageDaily = pgTable(
  "usage_daily",
  {
    id: serial("id").primaryKey(),
    platformAccountId: integer("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    product: text("product").$type<Product>().notNull(),
    model: text("model").notNull(),
    day: date("day").notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    costUsd: money("cost_usd").notNull().default(0),
    costIsEstimated: boolean("cost_is_estimated").notNull().default(false),
  },
  (t) => [
    uniqueIndex("usage_daily_grain_uq").on(t.platformAccountId, t.product, t.model, t.day),
    index("usage_daily_day_idx").on(t.day),
  ],
);

export const activityDaily = pgTable(
  "activity_daily",
  {
    id: serial("id").primaryKey(),
    platformAccountId: integer("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    product: text("product").$type<Product>().notNull(),
    day: date("day").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    sessions: integer("sessions").notNull().default(0),
    messages: integer("messages").notNull().default(0),
    linesAdded: integer("lines_added").notNull().default(0),
    linesAccepted: integer("lines_accepted").notNull().default(0),
    commits: integer("commits").notNull().default(0),
    pullRequests: integer("pull_requests").notNull().default(0),
    mostUsedModel: text("most_used_model"),
  },
  (t) => [
    uniqueIndex("activity_daily_grain_uq").on(t.platformAccountId, t.product, t.day),
    index("activity_daily_day_idx").on(t.day),
  ],
);

export const seats = pgTable(
  "seats",
  {
    id: serial("id").primaryKey(),
    platformAccountId: integer("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    seatType: text("seat_type").notNull().default("standard"),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
  },
  (t) => [
    uniqueIndex("seats_open_uq")
      .on(t.platformAccountId)
      .where(sql`${t.endedOn} is null`),
  ],
);

// Limits and budgets

export const platformLimits = pgTable(
  "platform_limits",
  {
    id: serial("id").primaryKey(),
    platformAccountId: integer("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    limitKind: text("limit_kind").notNull(),
    period: text("period").notNull().default("monthly"),
    source: text("source"),
    limitUsd: money("limit_usd"),
    usedUsd: money("used_usd").notNull().default(0),
    cycleStart: date("cycle_start").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("platform_limits_cycle_uq").on(t.platformAccountId, t.limitKind, t.period, t.cycleStart),
  ],
);

export const limitIncreaseRequests = pgTable(
  "limit_increase_requests",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    platformAccountId: integer("platform_account_id").references(() => platformAccounts.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    limitUsdAtRequest: money("limit_usd_at_request"),
    spendUsdAtRequest: money("spend_usd_at_request"),
  },
  (t) => [uniqueIndex("limit_increase_requests_ext_uq").on(t.platform, t.externalId)],
);

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  scopeType: text("scope_type").$type<"org" | "team" | "person">().notNull(),
  scopeId: integer("scope_id"),
  amountUsd: money("amount_usd").notNull(),
  note: text("note"),
  ...timestamps,
});

export const limitEvents = pgTable(
  "limit_events",
  {
    id: serial("id").primaryKey(),
    subjectType: text("subject_type").$type<"account" | "budget">().notNull(),
    subjectId: integer("subject_id").notNull(),
    limitRef: text("limit_ref").notNull(),
    threshold: doublePrecision("threshold").notNull(),
    cycleStart: date("cycle_start").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("limit_events_uq").on(t.subjectType, t.subjectId, t.limitRef, t.threshold, t.cycleStart),
  ],
);

// Findings

export const findings = pgTable(
  "findings",
  {
    id: serial("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    subjectType: text("subject_type").$type<"person" | "account" | "team" | "org">().notNull(),
    subjectKey: text("subject_key").notNull(),
    severity: text("severity").$type<"info" | "warning" | "critical">().notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    monthlyImpactUsd: money("monthly_impact_usd"),
    status: text("status").$type<"open" | "resolved" | "muted">().notNull().default("open"),
    firstSeenOn: date("first_seen_on").notNull(),
    lastSeenOn: date("last_seen_on").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("findings_active_uq")
      .on(t.ruleId, t.subjectType, t.subjectKey)
      .where(sql`${t.status} <> 'resolved'`),
  ],
);

// Settings (non-secret, editable in the UI)

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

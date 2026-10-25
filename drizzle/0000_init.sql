CREATE TABLE "activity_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform_account_id" integer NOT NULL,
	"platform" text NOT NULL,
	"product" text NOT NULL,
	"day" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_accepted" integer DEFAULT 0 NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"pull_requests" integer DEFAULT 0 NOT NULL,
	"most_used_model" text
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer,
	"amount_usd" numeric(14, 4) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_impact_usd" numeric(14, 4),
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_on" date NOT NULL,
	"last_seen_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"github_login" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer NOT NULL,
	"limit_ref" text NOT NULL,
	"threshold" double precision NOT NULL,
	"cycle_start" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limit_increase_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"platform_account_id" integer,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"limit_usd_at_request" numeric(14, 4),
	"spend_usd_at_request" numeric(14, 4)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_login" text,
	"display_name" text,
	"primary_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"email" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"name" text,
	"person_id" integer,
	"match_source" text DEFAULT 'unmatched' NOT NULL,
	"is_removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform_account_id" integer NOT NULL,
	"platform" text NOT NULL,
	"limit_kind" text NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"source" text,
	"limit_usd" numeric(14, 4),
	"used_usd" numeric(14, 4) DEFAULT 0 NOT NULL,
	"cycle_start" date NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector" text NOT NULL,
	"kind" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"range_start" date,
	"range_end" date,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform_account_id" integer NOT NULL,
	"platform" text NOT NULL,
	"seat_type" text DEFAULT 'standard' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"range_start" date,
	"range_end" date,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform_account_id" integer NOT NULL,
	"platform" text NOT NULL,
	"product" text NOT NULL,
	"model" text NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 4) DEFAULT 0 NOT NULL,
	"cost_is_estimated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_daily" ADD CONSTRAINT "activity_daily_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_increase_requests" ADD CONSTRAINT "limit_increase_requests_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_limits" ADD CONSTRAINT "platform_limits_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_github_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."github_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_daily_grain_uq" ON "activity_daily" USING btree ("platform_account_id","product","day");--> statement-breakpoint
CREATE INDEX "activity_daily_day_idx" ON "activity_daily" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_active_uq" ON "findings" USING btree ("rule_id","subject_type","subject_key") WHERE "findings"."status" <> 'resolved';--> statement-breakpoint
CREATE UNIQUE INDEX "github_teams_github_id_uq" ON "github_teams" USING btree ("github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_overrides_email_uq" ON "identity_overrides" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "limit_events_uq" ON "limit_events" USING btree ("subject_type","subject_id","limit_ref","threshold","cycle_start");--> statement-breakpoint
CREATE UNIQUE INDEX "limit_increase_requests_ext_uq" ON "limit_increase_requests" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_github_login_uq" ON "people" USING btree ("github_login");--> statement-breakpoint
CREATE UNIQUE INDEX "person_emails_email_uq" ON "person_emails" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_platform_ext_uq" ON "platform_accounts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "platform_accounts_email_idx" ON "platform_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "platform_accounts_person_idx" ON "platform_accounts" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_limits_cycle_uq" ON "platform_limits" USING btree ("platform_account_id","limit_kind","period","cycle_start");--> statement-breakpoint
CREATE INDEX "raw_payloads_connector_kind_idx" ON "raw_payloads" USING btree ("connector","kind","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seats_open_uq" ON "seats" USING btree ("platform_account_id") WHERE "seats"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "sync_runs_connector_idx" ON "sync_runs" USING btree ("connector","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_open_uq" ON "team_memberships" USING btree ("person_id","team_id") WHERE "team_memberships"."ended_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_grain_uq" ON "usage_daily" USING btree ("platform_account_id","product","model","day");--> statement-breakpoint
CREATE INDEX "usage_daily_day_idx" ON "usage_daily" USING btree ("day");
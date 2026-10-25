# Lasso Design

**Date:** 2026-10-26
**Status:** Draft for review
**Licence:** Apache-2.0
**Repo:** https://github.com/dovetail/lasso

## Problem

Organisations that adopt AI coding tools (Cursor, Claude Code, Claude Cowork) cannot see usage, cost, limits, or waste in one place. Spend grows with adoption; without cross-platform reporting it is hard to tell waste from healthy growth, to attribute cost to GitHub teams, or to spot people hitting limits. Dovetail’s September 2026 AI tooling review (~$45k/month, unused seats, tooling overlap, expensive models used for simple tasks) is the motivating case; Lasso is the open-source package that answers it for any org.

## Goals

- Report AI tooling usage and cost across Cursor and Claude (Claude Code + Cowork), for individuals and GitHub teams.
- Report historical cost and project forward (month / quarter / year), with what-if scenarios.
- Understand platform-enforced limits and org-defined budgets; surface people near limits and people who keep hitting them.
- Surface interesting org-level behaviour (idle seats, overlap, spikes, concentration, unmatched identities).
- Ship as a single container with a Postgres backing store, deployable on EKS or Fargate.
- Be a usable open-source package: Apache-2.0, demo mode with synthetic data, documented deploy examples.

## Non-goals (v1)

- Writing back to platforms (changing Cursor spend limits, inviting/removing seats). Lasso is read-only plus its own budgets.
- Real-time streaming. Hourly sync of daily aggregates is enough.
- Slack digests, CSV exports, or BI connectors as first-class products. The v1 surface is a web dashboard. A thin JSON API may exist for the dashboard’s own use; it is not a public contract in v1.
- Okta/Google SCIM identity sync. Identity comes from GitHub (verified/SAML emails) plus a manual override table.
- Role-gated visibility. Anyone who can sign in sees everything.
- Supporting GitHub Copilot, Windsurf, Gemini Code Assist, or other platforms. The connector interface leaves room; v1 ships Cursor + Claude only.
- Black-box ML forecasting. Projections are a transparent trailing-trend model with seasonality.

## Users

- Engineering leaders and platform/FinOps owners reviewing org-wide AI spend and adoption.
- Anyone with OIDC access to the deployment (full visibility).

## Constraints

- Single container image. One process can serve the web UI and run sync jobs. Role via `LASSO_ROLE=all|web|worker` so the same image can later split into two Fargate tasks without a rewrite.
- Postgres is the only required backing store (data + `pg-boss` job queue). No Redis, no SQS.
- Config via environment variables; secrets via the platform (Secrets Manager, Kubernetes secrets).
- TypeScript / Node 22.

## Architecture

```
                 ┌──────────────────────────────────────────┐
                 │              Lasso container             │
                 │                                          │
   OIDC ───────► │  Next.js (standalone)  ── dashboard UI   │
                 │         │                                │
                 │         ▼                                │
                 │  App services (reports, budgets, auth)   │
                 │         │                                │
                 │         ▼                                │
                 │  Postgres ◄── pg-boss (scheduled syncs)  │
                 │         ▲                                │
                 │         │                                │
                 │  Connectors (Cursor, Claude, GitHub, CSV)│
                 └─────────┬────────────────────────────────┘
                           │
           Cursor Admin · Claude Analytics / Claude Code
           Analytics · GitHub App · uploaded CSVs
```

### Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node 22, TypeScript |
| Web | Next.js App Router, standalone output |
| ORM / migrations | Drizzle |
| Jobs | `pg-boss` in the same Postgres |
| Auth | OIDC via `openid-client` |
| Packaging | Single multi-stage Dockerfile; image published to GHCR |
| Deploy examples | Helm chart (EKS), Terraform (Fargate + RDS) |

### Process roles

- `LASSO_ROLE=all` (default): serves HTTP and runs `pg-boss` workers.
- `LASSO_ROLE=web`: HTTP only.
- `LASSO_ROLE=worker`: workers only.

Migrations run on process start (idempotent). `/healthz` is liveness; `/readyz` checks Postgres connectivity.

### Connector interface

Each connector is a module behind one TypeScript interface:

```ts
interface Connector {
  id: "cursor" | "claude" | "github" | "claude-csv";
  listAccounts(): Promise<PlatformAccount[]>;
  syncUsage(range: DateRange): Promise<SyncResult>;
  syncCost(range: DateRange): Promise<SyncResult>;
  syncLimits(): Promise<SyncResult>; // no-op where unsupported
}
```

Connectors write only into `raw_payloads`. A separate normaliser turns raw rows into `usage_daily`, `seats`, `platform_limits`, and identity links. This lets us reprocess after a bug fix without re-calling APIs.

### Connectors in v1

#### Cursor (Admin API)

- Auth: team Admin API key (Basic auth).
- Endpoints used:
  - `POST /teams/daily-usage-data` — per-user daily activity (max 30 days/request; paginate for all members).
  - `POST /teams/spend` — current-cycle per-user spend and limits.
  - `POST /teams/filtered-usage-events` — event-level costs for model breakdown (sum `requestsCosts`).
  - `POST /teams/user-spend-limits` (read) — per-user spend limits.
- Sync cadence: hourly for usage/spend; limits on the same cadence.
- Rate limits: ~20 req/min on most endpoints; respect and back off.

#### Claude

Two paths, selected by configuration:

1. **Enterprise Analytics API** (primary). Key with `read:analytics`, created by the org Primary Owner.
   - `GET /v1/organizations/analytics/usage_report` — tokens over time; filter/group by `product` (`claude_code`, `cowork`, `chat`, …), `model`, user.
   - Engagement / user-activity endpoints for sessions and adoption.
   - Cost endpoints on usage-based Enterprise plans; on seat-based plans they reflect usage credits only.
   - Data available from 2026-01-01; ~1-day lag; max 31-day ranges.
2. **Team CSV upload** (fallback). Team plans have no Analytics API. The dashboard accepts the admin CSV export (up to 90 days) and stores it as a `raw_payloads` row with connector `claude-csv`. Claude Console / Claude Code Analytics API support is explicitly out of v1; the connector interface leaves room for it later.

Cowork is a first-class product dimension on both paths. On Team, Cowork per-person data arrives only via CSV.

#### GitHub (GitHub App)

- Installed on the org. Permissions: `members:read`, `metadata:read`. SAML/SCIM external-identity read requires org owner authorisation of the App for `admin:org` (or the org exposes verified emails only). If SAML identities are unavailable, matching falls back to verified emails + manual overrides; this is documented, not a hard failure.
- Syncs: org members, verified emails, SAML NameID emails where the App can read them, teams and memberships (with membership start/end so history survives moves).
- Identity resolution order for a platform account email:
  1. Manual override table.
  2. GitHub verified email match.
  3. GitHub SAML NameID match.
  4. Otherwise: unmatched → appears on the "needs mapping" screen; never dropped.

## Data model

Postgres. All monetary values are USD decimals. Days are UTC dates.

### Identity

- `people` — one row per human (`id`, `github_login`, `display_name`, `primary_email`, timestamps).
- `person_emails` — emails belonging to a person (`person_id`, `email`, `source`).
- `platform_accounts` — Cursor/Claude account linked to a person (`platform`, `external_id`, `email`, `person_id` nullable, `match_source` ∈ {`manual`, `github_verified`, `github_saml`, `unmatched`}).
- `github_teams` — (`id`, `slug`, `name`).
- `team_memberships` — (`person_id`, `team_id`, `started_on`, `ended_on` nullable).
- `identity_overrides` — manual email → person mappings, audited.

### Ingest

- `raw_payloads` — (`id`, `connector`, `fetched_at`, `range_start`, `range_end`, `content_type`, `payload` jsonb/bytea, `checksum`). Immutable.
- `sync_runs` — (`id`, `connector`, `started_at`, `finished_at`, `status`, `rows_written`, `error`).

### Facts

- `usage_daily` — grain: `(person_id nullable, platform_account_id, platform, product, model, day)`.
  - Metrics: `requests`, `input_tokens`, `output_tokens`, `sessions`, `lines_accepted`, `cost_usd`, `cost_is_estimated` bool.
  - `product` ∈ {`cursor`, `claude_code`, `cowork`, `chat`, `other`}.
- `seats` — (`platform_account_id`, `seat_type`, `monthly_price_usd`, `started_on`, `ended_on` nullable).

### Limits and budgets

- `platform_limits` — snapshot per sync (`platform_account_id`, `limit_kind`, `limit_value`, `used_value`, `cycle_start`, `cycle_end`, `captured_at`).
- `budgets` — org-defined (`scope_type` ∈ {`org`,`team`,`person`}, `scope_id`, `amount_usd`, `cadence`=`monthly`, `starts_on`, `ends_on` nullable).
- `limit_events` — emitted when a subject crosses 80% or 100% of a platform limit or budget (`subject_type`, `subject_id`, `limit_ref`, `threshold`, `occurred_at`, `cycle_id`).

### Findings and scenarios

- `findings` — (`rule_id`, `subject_type`, `subject_id`, `severity`, `title`, `evidence` jsonb, `first_seen_on`, `last_seen_on`, `status` ∈ {`open`,`resolved`,`muted`}). Partial unique index on (`rule_id`, `subject_type`, `subject_id`) where `status = 'open'`, so recurrence updates `last_seen_on` instead of duplicating.
- `cost_scenarios` — saved what-ifs (`id`, `name`, `params` jsonb, `created_by`, `created_at`). Results are computed on read from current facts + `params`, not stored.

## Analysis

### Cost history

- Org / team / person spend by day and month, split by platform and product.
- Seat cost vs usage cost shown separately.
- Estimated costs (derived from tokens when the API does not return dollars) are flagged in the UI.

### Projections

- Horizons: end of current month, current quarter, current year.
- Seat cost: known from `seats`; not modelled.
- Usage cost: trailing daily series with day-of-week seasonality; output a low / expected / high band (quantile-style from residual distribution, not a black box).
- What-if scenarios (saved): change headcount, move N people Claude → Cursor (or reverse), remove idle seats, shift X% of high-reasoning usage to cheaper models. Each scenario shows delta vs baseline projection and vs budgets.

### Limits and budgets

- Per person, per limit: status `ok` | `near` (≥80% of cycle) | `at_or_over` (≥100%).
- Burn-rate check: at current pace, will they hit the limit before cycle reset?
- "Keeps bumping into limits": crossed 100% in ≥2 of the last 3 cycles; ranked by hit count.

### Findings (initial rules)

Thresholds are configurable; defaults below.

| Rule ID | Signal | Default |
| --- | --- | --- |
| `idle_seat` | Paid seat, no activity | 30 days; report monthly savings |
| `tool_overlap` | Seats on both platforms; one has ≥90% of the person's request volume | lookback 30 days |
| `expensive_model_simple_work` | High-reasoning model (Opus-class / o1-class) on requests with total tokens under 2k | ≥20 such requests in 7 days |
| `spike` | Daily cost ≫ baseline | z ≥ 3 vs 28-day baseline |
| `declining_adoption` | Team active-user share falling | 4-week regression, slope negative and drop ≥15% |
| `concentration` | One person driving large share of team spend | ≥40% of team usage cost over 30 days |
| `unmatched_account` | Platform account with no person | any |

Findings are re-evaluated after each successful sync. Resolved when the signal clears for a grace period (default 7 days).

## Dashboard

OIDC sign-in. Full visibility for every signed-in user.

Pages:

1. **Overview** — org spend (MTD), projection band, top findings, limit-pressure summary.
2. **Teams** — GitHub teams with spend, adoption, limit pressure; drill into a team.
3. **People** — searchable roster with platform accounts, spend, limit status.
4. **Costs** — history charts, projection, saved what-if scenarios.
5. **Limits** — near / at / repeat offenders; budgets CRUD.
6. **Findings** — open findings by severity; mute / resolve.
7. **Settings** — connector credentials status (never show secrets), identity overrides, Claude Team CSV upload, sync health (`sync_runs`).

Stale-data banner when the latest successful sync for a connector is older than 2× its cadence.

## Error handling and sync behaviour

- Per-connector retries with exponential backoff, capped by platform rate limits.
- Usage sync is incremental from the last successful `range_end`; failures leave prior facts intact.
- Connectors are independent: Claude failing does not block Cursor.
- Sync errors land in `sync_runs` and on the Settings → Health page; they do not 500 the dashboard.
- Invalid or incomplete CSV uploads are rejected with a field-level error; nothing partial is written to facts.

## Configuration

Environment variables (illustrative, final names in README):

- `DATABASE_URL`
- `LASSO_ROLE` = `all` \| `web` \| `worker`
- `LASSO_SESSION_SECRET` — cookie signing
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`
- `CURSOR_API_KEY`
- `CLAUDE_ANALYTICS_API_KEY` (Enterprise). Optional later: `CLAUDE_ADMIN_API_KEY` for Claude Console / Claude Code Analytics (not required for v1).
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`
- `LASSO_DEMO=1` — seed synthetic data, skip real connectors
- `LASSO_RETENTION_DAYS` — default `400` for `usage_daily` and `raw_payloads` (covers a year plus buffer); older rows are pruned by a daily job

No secrets in the image. No secrets in logs.

## Deployment

- One Dockerfile, multi-stage, distroless or `node:22-slim` runtime.
- Image published to `ghcr.io/dovetail/lasso`.
- Helm chart under `deploy/helm/lasso` for EKS (Deployment + Service + Ingress + ExternalSecret pattern; Postgres via RDS or in-cluster).
- Terraform under `deploy/terraform/fargate` for ECS Fargate + RDS Postgres + ALB, OIDC at the app.
- `/healthz`, `/readyz` for probes.
- Resource guidance in README (starting point: 512 MB / 0.25 vCPU for small orgs; scale with member count and retention).

## Testing

- **Unit:** normaliser, projection math, limit status, each finding rule — hand-built fixtures with known expected outputs.
- **Connector:** recorded HTTP fixtures (no live network in CI).
- **Integration:** real Postgres via Testcontainers; sync → normalise → query path.
- **Smoke:** build the Docker image, boot against Postgres, hit `/readyz`.
- CI: GitHub Actions. PR checks = unit + connector + integration. Main builds and publishes the image to GHCR.

## Open source

- Apache-2.0 (`LICENSE`).
- Public repo under `dovetail/lasso`.
- `README.md` with quickstart (Docker Compose: app + Postgres), configuration reference, and deploy links.
- Demo mode (`LASSO_DEMO=1`) generates a synthetic org so the dashboard is usable without API keys.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue / PR templates.
- Security: private vulnerability reporting via GitHub; never commit credentials; document required token scopes.

## Project layout (target)

```
lasso/
  apps/web/                 # Next.js app (UI + server routes)
  packages/
    core/                   # domain types, normaliser, analysis
    connectors/             # cursor, claude, github, csv
    db/                     # Drizzle schema + migrations
  deploy/
    helm/lasso/
    terraform/fargate/
    compose/                # local docker-compose
  docs/superpowers/
    specs/
    plans/
  .github/workflows/
```

Monorepo with `pnpm` workspaces. One container build that packages `apps/web` (which depends on the packages).

## Rollout / phasing of implementation

Implementation plans will break this into vertical slices. Intended order:

1. Skeleton: monorepo, Docker, Postgres, Drizzle, `/healthz`/`/readyz`, OIDC stub, demo seed.
2. Identity: GitHub connector + people / teams / overrides UI.
3. Cursor connector → raw → `usage_daily` → Overview + People spend.
4. Claude Enterprise connector + CSV upload path.
5. Limits + budgets + limit-pressure views.
6. Projections + what-if scenarios.
7. Findings engine + initial rules.
8. Helm + Terraform examples, README polish, first tagged release.

## Risks and open points (resolved for v1)

| Topic | Decision |
| --- | --- |
| Claude Team has no Analytics API | CSV upload fallback; document the gap |
| Cowork coverage | Enterprise: Analytics API `products[]=cowork`. Team: CSV only |
| Cost estimation when APIs omit dollars | Store `cost_is_estimated=true`; show badge in UI |
| Projection model | Trailing trend + DOW seasonality; revisit only with evidence |
| Visibility | Full visibility for all signed-in users |
| Auth | Generic OIDC |
| Licence | Apache-2.0 |

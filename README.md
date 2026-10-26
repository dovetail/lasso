# Lasso

Lasso reports on how your organisation uses AI coding tools: who uses what, what it costs, where it's heading, and who keeps running into limits. It currently supports **Cursor** and **Claude** (Claude Code, Cowork and chat, on Team and Enterprise plans), and maps people to **GitHub teams**.

It runs as a single container backed by Postgres, so it fits on EKS, ECS Fargate, or anywhere else you can run a container.

## What you get

- **People and teams.** Usage, spend, active days and top models for each person and GitHub team. Platform accounts are matched to GitHub users by verified or SAML email, and you can fix the rest with manual overrides.
- **Costs and projections.** Daily and monthly history, plus month, quarter and year projections with a range. The forecast uses a damped trend with weekday seasonality. A what-if calculator models adding seats, moving people between tools, reclaiming idle seats or shifting usage to cheaper models.
- **Limits.** Per-user spend limits from Cursor and Claude, and who is near them, over them, on track to hit them, or at the limit cycle after cycle. Claude limit-increase requests are included. You can also set monthly budgets for the org, a team or a person.
- **Findings.** Patterns worth acting on:
  - idle seats
  - people paying for both tools but using one
  - premium models used for small requests
  - spend spikes
  - declining adoption in a team
  - spend concentrated in one person
  - accounts that don't match anyone in GitHub
  - repeated limit hits

  You can mute or resolve findings, and tune thresholds in Settings.

## Try it with demo data

```bash
docker-compose up -d postgres
pnpm install
LASSO_DEMO=1 LASSO_AUTH_MODE=none pnpm dev
# http://localhost:3000
```

Or run the whole thing in containers:

```bash
LASSO_DEMO=1 docker-compose --profile app up --build
```

`LASSO_DEMO=1` loads a synthetic organisation of 60 people across 7 teams, but only into an empty database. Use `pnpm demo:seed --reset` to wipe and reseed.

## Connect your accounts

Copy `.env.example` to `.env`, fill in whichever connectors you have, and start Lasso. Each connector is optional. On first start, Lasso backfills `LASSO_BACKFILL_DAYS` (90 by default) and then syncs hourly. **Settings → Sync now** triggers a sync on demand, and the Settings page shows the health of each connector.

| Connector | Variables | Where to get it |
| --- | --- | --- |
| Cursor | `CURSOR_API_KEY` | Cursor dashboard → Settings → Advanced → Admin API keys. Needs a Team or Enterprise admin. |
| Claude usage (Enterprise) | `CLAUDE_ANALYTICS_API_KEY` | claude.ai admin settings → API keys, with the `read:analytics` scope. |
| Claude spend limits (Enterprise) | `CLAUDE_ADMIN_API_KEY` | An Admin API key with `read:spend_limits`. Adds per-user limits and increase requests. |
| Claude Team plans | none | Team plans have no usage API. Upload a usage CSV under **Settings → Claude usage CSV**. A template is provided. |
| GitHub | `GITHUB_ORG` plus `GITHUB_TOKEN`, or `GITHUB_APP_ID` + `GITHUB_APP_INSTALLATION_ID` + `GITHUB_APP_PRIVATE_KEY` | A token with `read:org` (and `admin:org` to read SAML identities), or a GitHub App with *Members: read* installed on the org. |

Before you trust the totals, confirm your seat prices in **Settings**. The platform APIs don't expose contract pricing, so Lasso starts with placeholder prices.

### How people are matched

Each Cursor or Claude account is matched to a person in this order:

1. a manual override (Settings → Identity overrides)
2. the person's SAML identity email
3. their GitHub organisation-verified domain email
4. their public GitHub email

Accounts that match nobody still appear as people, flagged as *unmatched*. Team spend is attributed by membership on the day the usage happened. A person in two teams counts towards both.

## Sign-in

Lasso uses OpenID Connect and works with Google, Okta, Entra ID, Auth0 or Keycloak. Register a web client with the redirect URI `https://<your-host>/auth/callback`, then set:

```bash
LASSO_AUTH_MODE=oidc
LASSO_SESSION_SECRET=$(openssl rand -base64 48)
LASSO_BASE_URL=https://lasso.example.com
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_ALLOWED_DOMAINS=example.com   # optional allowlist
```

Everyone who can sign in sees everything. `LASSO_AUTH_MODE=none` turns sign-in off. Only use it locally or behind something that already authenticates.

## Deploy

The image is published to `ghcr.io/dovetail/lasso`. It listens on port 3000, runs database migrations on start (safe with several replicas), and exposes `/healthz` (liveness) and `/readyz` (database reachable).

- **Kubernetes / EKS:** Helm chart in [`deploy/helm/lasso`](deploy/helm/lasso). Put the secrets in a Kubernetes Secret and point `existingSecret` at it.

  ```bash
  kubectl create secret generic lasso-env --from-env-file=.env
  helm install lasso deploy/helm/lasso --set existingSecret=lasso-env \
    --set env.LASSO_BASE_URL=https://lasso.example.com --set ingress.enabled=true
  ```

- **ECS Fargate:** Terraform in [`deploy/terraform/fargate`](deploy/terraform/fargate) creates the cluster, service, ALB with HTTPS, and log group, with secrets read from Secrets Manager or SSM. Bring your own VPC and Postgres (RDS works well). Start from `example.tfvars`.

### Process roles

By default one process serves the UI and runs the background sync (`LASSO_ROLE=all`). To scale them separately, run one deployment with `LASSO_ROLE=web` and another with `LASSO_ROLE=worker`. Jobs use [pg-boss](https://github.com/timgit/pg-boss) on the same Postgres database, so you don't need anything else.

### Configuration reference

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://lasso:lasso@localhost:55432/lasso` | Postgres 14+. |
| `LASSO_ROLE` | `all` | `all`, `web` or `worker`. |
| `LASSO_SYNC_CRON` | `15 * * * *` | Sync schedule (UTC). |
| `LASSO_BACKFILL_DAYS` | `90` | History fetched on the first sync. Claude analytics data starts on 2026-01-01. |
| `LASSO_RETENTION_DAYS` | `400` | Daily facts and raw payloads older than this are pruned nightly. |
| `LASSO_DEMO` | off | Seed demo data into an empty database. |

## Known limitations (v0.1)

- **Claude Team plans:** usage comes from CSV uploads, not an API, so it is only as current as your last upload.
- **Budgets:** they compare against usage-based spend only. Seat costs are excluded.
- **Seat costs:** these are your configured price × open seats, prorated by day. Discounts, annual commitments and taxes aren't modelled.
- **Cursor limits:** Cursor reports each user's effective on-demand limit and their spend in the current cycle. Team-wide hard limits aren't shown yet.
- **Other tools:** only Cursor and Claude are supported. The connector interface in `src/connectors` is designed to make adding Copilot, Windsurf or others straightforward.

## Development

```bash
docker-compose up -d postgres   # Postgres on localhost:55432
pnpm install
pnpm dev                       # http://localhost:3000
pnpm test                      # unit tests (vitest)
pnpm lint                      # typecheck
pnpm sync [cursor|claude|github]   # run a sync from the command line
pnpm db:generate               # create a migration after editing src/db/schema.ts
```

The code is laid out as follows:

- `src/connectors`: API clients and pure normalisers
- `src/ingest`: writes to Postgres, identity resolution, sync orchestration
- `src/analysis`: projections, limits, findings, queries
- `src/app`: the Next.js dashboard

## Licence

[Apache-2.0](LICENSE)

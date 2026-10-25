import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://lasso:lasso@localhost:55432/lasso"),
  LASSO_ROLE: z.enum(["all", "web", "worker"]).default("all"),
  LASSO_AUTH_MODE: z.enum(["oidc", "none"]).default("oidc"),
  LASSO_SESSION_SECRET: optional,
  LASSO_BASE_URL: optional,
  LASSO_DEMO: bool,
  LASSO_SYNC_CRON: z.string().default("15 * * * *"),
  LASSO_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  LASSO_RETENTION_DAYS: z.coerce.number().int().min(30).default(400),

  OIDC_ISSUER: optional,
  OIDC_CLIENT_ID: optional,
  OIDC_CLIENT_SECRET: optional,
  OIDC_SCOPES: z.string().default("openid email profile"),
  OIDC_ALLOWED_DOMAINS: optional,

  CURSOR_API_KEY: optional,
  CURSOR_API_BASE: z.string().default("https://api.cursor.com"),

  CLAUDE_ANALYTICS_API_KEY: optional,
  CLAUDE_ADMIN_API_KEY: optional,
  CLAUDE_API_BASE: z.string().default("https://api.anthropic.com"),

  GITHUB_ORG: optional,
  GITHUB_TOKEN: optional,
  GITHUB_APP_ID: optional,
  GITHUB_APP_INSTALLATION_ID: optional,
  GITHUB_APP_PRIVATE_KEY: optional,
  GITHUB_API_BASE: z.string().default("https://api.github.com"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function resetEnvForTests() {
  cached = undefined;
}

export function connectorConfig() {
  const e = env();
  return {
    cursor: Boolean(e.CURSOR_API_KEY),
    claudeAnalytics: Boolean(e.CLAUDE_ANALYTICS_API_KEY),
    claudeLimits: Boolean(e.CLAUDE_ADMIN_API_KEY),
    github: Boolean(e.GITHUB_ORG && (e.GITHUB_TOKEN || (e.GITHUB_APP_ID && e.GITHUB_APP_PRIVATE_KEY))),
  };
}

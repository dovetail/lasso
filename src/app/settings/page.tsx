import { asc, eq } from "drizzle-orm";
import { dataExtent, syncHealth } from "@/analysis/queries";
import { addOverrideAction, deleteOverrideAction, saveSettingsAction, syncNowAction, uploadClaudeCsvAction } from "@/app/actions";
import { db } from "@/db/client";
import { identityOverrides, platformAccounts } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { relative } from "@/components/format";
import { Badge, Button, Card, Field, inputClass, PageHeader, PlatformBadge, Table, Td } from "@/components/ui";
import { connectorConfig, env } from "@/lib/env";
import { getSettings } from "@/lib/settings";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const d = db();
  const e = env();
  const cfg = connectorConfig();
  const [settings, health, extent, overrides, unmatched] = await Promise.all([
    getSettings(d),
    syncHealth(d),
    dataExtent(d),
    d.select().from(identityOverrides).orderBy(asc(identityOverrides.email)),
    d.select().from(platformAccounts).where(eq(platformAccounts.matchSource, "unmatched")).orderBy(asc(platformAccounts.email)),
  ]);
  const t = settings.thresholds;
  const runFor = (c: string) => health.find((h) => h.connector === c);

  const connectors = [
    { id: "github", name: "GitHub", configured: cfg.github, detail: e.GITHUB_ORG ? `org ${e.GITHUB_ORG}${e.GITHUB_APP_ID ? " via GitHub App" : e.GITHUB_TOKEN ? " via token" : ""}` : "GITHUB_ORG not set", env: "GITHUB_ORG + GITHUB_TOKEN, or GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID / GITHUB_APP_PRIVATE_KEY" },
    { id: "cursor", name: "Cursor", configured: cfg.cursor, detail: "Admin API", env: "CURSOR_API_KEY" },
    {
      id: "claude",
      name: "Claude",
      configured: cfg.claudeAnalytics || cfg.claudeLimits,
      detail: [cfg.claudeAnalytics ? "Analytics API" : null, cfg.claudeLimits ? "spend limits" : null].filter(Boolean).join(" + ") || "Enterprise APIs not configured",
      env: "CLAUDE_ANALYTICS_API_KEY (read:analytics), CLAUDE_ADMIN_API_KEY (read:spend_limits)",
    },
    { id: "claude-csv", name: "Claude CSV upload", configured: true, detail: "For Team plans, or as a backfill", env: null },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Data from ${extent.min ?? "–"} to ${extent.max ?? "–"} across ${extent.accounts} platform accounts. Sign-in: ${e.LASSO_AUTH_MODE === "none" ? "disabled (LASSO_AUTH_MODE=none)" : "OIDC"}.`}
        actions={
          <form action={syncNowAction}>
            <Button>Sync now</Button>
          </form>
        }
      />
      <Flash params={sp} />

      <Card title="Connectors" subtitle="Keys are read from environment variables and are never shown here. Sync runs hourly by default.">
        <Table head={["Connector", "Configured", "Last run", "Last success", "Rows", "Notes"]}>
          {connectors.map((c) => {
            const h = runFor(c.id);
            return (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>{c.configured ? <Badge color="emerald">yes</Badge> : <Badge>no</Badge>}</Td>
                <Td>{h ? <Badge color={h.status === "success" ? "emerald" : h.status === "failed" ? "rose" : "amber"}>{h.status} {relative(h.started_at)}</Badge> : <span className="text-slate-400">never</span>}</Td>
                <Td className="text-slate-600">{relative(h?.last_success)}</Td>
                <Td className="tabular text-slate-600">{h?.rows_written ?? "–"}</Td>
                <Td className="max-w-md whitespace-normal! text-xs text-slate-600">
                  {c.detail}
                  {!c.configured && c.env && <div className="mt-0.5 break-all font-mono text-slate-500">{c.env}</div>}
                  {h?.status === "failed" && h.error && <div className="mt-1 text-rose-700">{h.error.slice(0, 300)}</div>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Pricing & thresholds" subtitle="Seat prices are not available from the platform APIs, so set them to match your contracts.">
          <form action={saveSettingsAction} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cursor seat (USD/month)">
                <input name="seat_cursor" type="number" step="any" min={0} defaultValue={settings.seatPriceUsd.cursor} className={inputClass} />
              </Field>
              <Field label="Claude seat (USD/month)">
                <input name="seat_claude" type="number" step="any" min={0} defaultValue={settings.seatPriceUsd.claude} className={inputClass} />
              </Field>
            </div>
            {!settings.seatPricesConfirmed && <p className="-mt-2 text-xs text-amber-700">These are defaults. Saving confirms them.</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Near-limit threshold (%)">
                <input name="nearLimitRatio" type="number" min={10} max={100} defaultValue={Math.round(t.nearLimitRatio * 100)} className={inputClass} />
              </Field>
              <Field label="Idle seat after (days)">
                <input name="idleSeatDays" type="number" min={7} defaultValue={t.idleSeatDays} className={inputClass} />
              </Field>
              <Field label="Tool overlap: dominant share (%)">
                <input name="overlapDominantShare" type="number" min={50} max={100} defaultValue={Math.round(t.overlapDominantShare * 100)} className={inputClass} />
              </Field>
              <Field label="Spike: z-score">
                <input name="spikeZScore" type="number" step="0.5" min={1} defaultValue={t.spikeZScore} className={inputClass} />
              </Field>
              <Field label="Spike: minimum day (USD)">
                <input name="spikeMinUsd" type="number" min={0} defaultValue={t.spikeMinUsd} className={inputClass} />
              </Field>
              <Field label="Concentration: share of team (%)">
                <input name="concentrationShare" type="number" min={10} max={100} defaultValue={Math.round(t.concentrationShare * 100)} className={inputClass} />
              </Field>
              <Field label="Concentration: min team spend (USD/30d)">
                <input name="concentrationMinTeamUsd" type="number" min={0} defaultValue={t.concentrationMinTeamUsd} className={inputClass} />
              </Field>
              <Field label="Adoption drop (percentage points)">
                <input name="adoptionDropShare" type="number" min={1} max={100} defaultValue={Math.round(t.adoptionDropShare * 100)} className={inputClass} />
              </Field>
              <Field label="Expensive model: max tokens/request">
                <input name="expensiveModelMaxTokensPerRequest" type="number" min={100} defaultValue={t.expensiveModelMaxTokensPerRequest} className={inputClass} />
              </Field>
              <Field label="Expensive model: min requests (30d)">
                <input name="expensiveModelMinRequests" type="number" min={1} defaultValue={t.expensiveModelMinRequests} className={inputClass} />
              </Field>
            </div>
            <Field label="Expensive model pattern" hint="Case-insensitive regular expression matched against model names.">
              <input name="expensiveModelPattern" defaultValue={t.expensiveModelPattern} className={`${inputClass} font-mono`} />
            </Field>
            <Button>Save and recalculate</Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card title="Claude usage CSV" subtitle="Upload a usage export for Claude Team plans, or to backfill. Rows replace existing data for the same dates and products.">
            <div id="claude-csv" />
            <form action={uploadClaudeCsvAction} className="space-y-3">
              <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200" />
              <div className="flex items-center gap-3">
                <Button>Upload</Button>
                <a href="/api/claude-csv-template" className="text-sm text-indigo-700 hover:underline">
                  Download template
                </a>
              </div>
            </form>
          </Card>

          <Card title="Identity overrides" subtitle="Map an email that GitHub can't verify to a GitHub login. Overrides win over automatic matching.">
            <div id="identity" />
            <form action={addOverrideAction} className="mb-5 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Field label="Email">
                  <input name="email" type="email" required className={inputClass} placeholder="someone@company.com" />
                </Field>
              </div>
              <div className="w-40">
                <Field label="GitHub login">
                  <input name="githubLogin" required className={inputClass} placeholder="octocat" />
                </Field>
              </div>
              <Button>Add</Button>
            </form>
            <Table head={["Email", "GitHub login", "Added by", ""]} empty="No overrides.">
              {overrides.map((o) => (
                <tr key={o.id}>
                  <Td>{o.email}</Td>
                  <Td>@{o.githubLogin}</Td>
                  <Td className="text-xs text-slate-500">{o.createdBy ?? "–"}</Td>
                  <Td>
                    <form action={deleteOverrideAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="text-xs text-slate-500 hover:text-rose-700">Remove</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={`Unmatched accounts (${unmatched.length})`} subtitle="Accounts whose email isn't linked to anyone in your GitHub org. Add an override to attribute them to a person and team.">
            <Table head={["Tool", "Email", "Name", "Status"]} empty="Everyone is matched.">
              {unmatched.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <PlatformBadge platform={a.platform} />
                  </Td>
                  <Td>{a.email ?? a.externalId}</Td>
                  <Td className="text-slate-600">{a.name ?? "–"}</Td>
                  <Td>{a.isRemoved ? <Badge>removed</Badge> : <Badge color="emerald">active</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}

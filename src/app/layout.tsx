import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { currentUser } from "@/auth/current";
import { db } from "@/db/client";
import { findings } from "@/db/schema";
import { syncHealth } from "@/analysis/queries";
import { Nav } from "@/components/Nav";
import { relative } from "@/components/format";
import { connectorConfig, env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lasso",
  description: "AI tooling usage, cost and limits across your organisation",
};

export const dynamic = "force-dynamic";

async function staleWarning(): Promise<string | null> {
  const cfg = connectorConfig();
  const configured = (Object.keys(cfg) as Array<keyof typeof cfg>).filter((k) => cfg[k]).map((k) => (k === "claudeAnalytics" || k === "claudeLimits" ? "claude" : k));
  if (!configured.length) return env().LASSO_DEMO ? null : "No connectors are configured yet. Add API keys and restart, or upload a Claude CSV in Settings.";
  const health = await syncHealth(db());
  const problems: string[] = [];
  for (const c of new Set(configured)) {
    const h = health.find((x) => x.connector === c);
    if (!h) continue;
    if (h.status === "failed") problems.push(`${c} sync failed (last success ${relative(h.last_success)})`);
    else if (h.last_success && Date.now() - new Date(h.last_success).getTime() > 26 * 3600_000) problems.push(`${c} data is stale (last success ${relative(h.last_success)})`);
  }
  return problems.length ? `${problems.join("; ")}. See Settings for details.` : null;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, openCount, stale] = await Promise.all([
    currentUser(),
    db()
      .select({ n: count() })
      .from(findings)
      .where(eq(findings.status, "open"))
      .then((r) => r[0]?.n ?? 0)
      .catch(() => 0),
    staleWarning().catch(() => null),
  ]);
  const e = env();
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-slate-900 px-3 py-5">
            <div className="mb-6 px-3">
              <div className="text-lg font-semibold tracking-tight text-white">Lasso</div>
              <div className="text-xs text-slate-400">AI tooling usage & cost</div>
            </div>
            <Nav findingsCount={openCount} />
            <div className="mt-auto space-y-2 px-3 text-xs text-slate-400">
              {e.LASSO_DEMO && <div className="rounded-md bg-amber-400/15 px-2 py-1 text-amber-300">Demo data</div>}
              {user && <div className="truncate">{user.email ?? user.name}</div>}
              {e.LASSO_AUTH_MODE === "oidc" && user && (
                <form action="/auth/logout" method="post">
                  <button className="hover:text-white">Sign out</button>
                </form>
              )}
            </div>
          </aside>
          <main className="min-w-0 flex-1">
            {stale && <div className="border-b border-amber-200 bg-amber-50 px-8 py-2 text-sm text-amber-900">{stale}</div>}
            <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

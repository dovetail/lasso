import Link from "next/link";
import { findingLinks, openFindings } from "@/analysis/reports";
import { db } from "@/db/client";
import { Flash } from "@/components/Flash";
import { FindingList, RULE_LABEL } from "@/components/FindingList";
import { money } from "@/components/format";
import { Card, PageHeader, Stat } from "@/components/ui";

const STATUSES = ["open", "muted", "resolved"] as const;

const RULE_HELP: Record<string, string> = {
  idle_seat: "Paid seats with no activity for the idle threshold.",
  tool_overlap: "People paying for both tools but using one almost exclusively.",
  expensive_model_simple_work: "Heavy use of premium models on small requests.",
  spend_spike: "A day far above someone's recent average.",
  declining_adoption: "Teams whose active-day share is falling.",
  spend_concentration: "A single person driving a large share of a team's spend.",
  unmatched_accounts: "Platform accounts not linked to a GitHub identity.",
  repeated_limit_hits: "People who keep hitting their spend limits.",
};

export default async function Findings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "open";
  const rule = sp.rule;
  const d = db();
  const all = await openFindings(d, { status });
  const items = rule ? all.filter((f) => f.ruleId === rule) : all;
  const links = await findingLinks(d, items);
  const byRule = new Map<string, { count: number; impact: number }>();
  for (const f of all) {
    const r = byRule.get(f.ruleId) ?? { count: 0, impact: 0 };
    r.count++;
    r.impact += f.monthlyImpactUsd ?? 0;
    byRule.set(f.ruleId, r);
  }
  const impact = all.reduce((a, f) => a + (f.monthlyImpactUsd ?? 0), 0);
  const returnTo = `/findings?status=${status}${rule ? `&rule=${rule}` : ""}`;

  return (
    <>
      <PageHeader title="Findings" subtitle="Patterns worth a look, recalculated after every sync. Thresholds are adjustable in Settings." />
      <Flash params={sp} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`${status} findings`} value={all.length} />
        <Stat label="Estimated monthly impact" value={money(impact, { cents: false })} hint="Where a saving can be estimated" tone={impact > 0 ? "good" : undefined} />
        <Stat label="Critical" value={all.filter((f) => f.severity === "critical").length} tone={all.some((f) => f.severity === "critical") ? "bad" : undefined} />
        <Stat label="Warnings" value={all.filter((f) => f.severity === "warning").length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <div className="space-y-4">
          <Card title="Status">
            <div className="-my-1 flex flex-col gap-1 text-sm">
              {STATUSES.map((s) => (
                <Link key={s} href={`/findings?status=${s}`} className={`rounded-md px-2 py-1 capitalize ${status === s ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  {s}
                </Link>
              ))}
            </div>
          </Card>
          <Card title="By rule">
            <div className="-my-1 flex flex-col gap-1 text-sm">
              <Link href={`/findings?status=${status}`} className={`rounded-md px-2 py-1 ${!rule ? "bg-slate-100 font-medium" : "text-slate-700 hover:bg-slate-100"}`}>
                All rules
              </Link>
              {[...byRule.entries()]
                .sort((a, b) => b[1].count - a[1].count)
                .map(([r, v]) => (
                  <Link key={r} href={`/findings?status=${status}&rule=${r}`} title={RULE_HELP[r]} className={`flex justify-between rounded-md px-2 py-1 ${rule === r ? "bg-slate-100 font-medium" : "text-slate-700 hover:bg-slate-100"}`}>
                    <span>{RULE_LABEL[r] ?? r}</span>
                    <span className="tabular text-slate-500">{v.count}</span>
                  </Link>
                ))}
            </div>
          </Card>
        </div>
        <Card className="lg:col-span-3" title={rule ? RULE_LABEL[rule] ?? rule : "All findings"} subtitle={rule ? RULE_HELP[rule] : undefined}>
          <FindingList items={items} returnTo={returnTo} links={links} />
        </Card>
      </div>
    </>
  );
}

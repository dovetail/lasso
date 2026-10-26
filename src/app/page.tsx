import Link from "next/link";
import { costModel, limitsView, openFindings, peopleSummary } from "@/analysis/reports";
import { teamSummary } from "@/analysis/queries";
import { db } from "@/db/client";
import { BarList } from "@/components/BarList";
import { SpendChart } from "@/components/charts";
import { FindingList } from "@/components/FindingList";
import { money, PRODUCT_LABEL } from "@/components/format";
import { Card, PageHeader, Stat, StatusBadge, TextLink } from "@/components/ui";
import { today } from "@/lib/dates";

export default async function Overview() {
  const d = db();
  const asOf = today();
  const [model, findings, limits, people, teams] = await Promise.all([
    costModel(d, {}, asOf),
    openFindings(d, { limit: 6 }),
    limitsView(d, asOf),
    peopleSummary(d, asOf),
    teamSummary(d, asOf),
  ]);
  const month = model.projections[0]!;
  const mtd = model.mtd.cursor + model.mtd.claude;
  const savings = findings.reduce((a, f) => a + (f.monthlyImpactUsd ?? 0), 0);
  const near = limits.filter((l) => l.status === "near").length;
  const over = limits.filter((l) => l.status === "at_or_over").length;
  const active30 = people.filter((p) => p.activeDays30 > 0).length;
  const seats = model.seatsNow.cursor + model.seatsNow.claude;

  return (
    <>
      <PageHeader title="Overview" subtitle={`As of ${asOf}. Usage-based spend plus seat costs.`} />
      {!model.settings.seatPricesConfirmed && (
        <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
          Seat prices are defaults (${model.settings.seatPriceUsd.cursor} Cursor, ${model.settings.seatPriceUsd.claude} Claude per month).{" "}
          <Link href="/settings" className="font-medium underline">
            Confirm your contract prices
          </Link>{" "}
          for accurate totals.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Usage spend MTD" value={money(mtd)} hint={`Cursor ${money(model.mtd.cursor)} · Claude ${money(model.mtd.claude)}`} />
        <Stat label="Projected this month" value={money(month.total)} hint={`${money(month.low)} – ${money(month.high)} incl. ${money(month.seatCost)} seats`} />
        <Stat label="Active people (30d)" value={`${active30}`} hint={`${seats} seats · ${model.seatsNow.cursor} Cursor, ${model.seatsNow.claude} Claude`} />
        <Stat
          label="Limit pressure"
          value={`${over} at · ${near} near`}
          tone={over ? "bad" : near ? "warn" : undefined}
          hint={<TextLink href="/limits">View limits</TextLink>}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Daily usage spend" subtitle="Last 90 days, with forecast to month end" className="lg:col-span-2">
          <SpendChart data={model.chart} />
        </Card>
        <Card title="Spend by product" subtitle="Last 30 days">
          <BarList items={model.byProduct.map((p) => ({ label: PRODUCT_LABEL[p.product] ?? p.product, value: p.cost }))} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Top findings"
          subtitle={savings > 0 ? `About ${money(savings)}/month of potential savings across open findings shown` : undefined}
          className="lg:col-span-2"
          actions={<TextLink href="/findings">All findings</TextLink>}
        >
          <FindingList items={findings} returnTo="/" />
        </Card>
        <div className="space-y-6">
          <Card title="Top teams" subtitle="Usage spend, last 30 days" actions={<TextLink href="/teams">All</TextLink>}>
            <BarList items={teams.slice(0, 6).map((t) => ({ label: t.name, value: t.cost30, href: `/teams/${t.id}`, sub: `${t.members} people` }))} />
          </Card>
          <Card title="Closest to limits">
            {limits.filter((l) => l.ratio != null).length === 0 ? (
              <p className="text-sm text-slate-500">No per-user limits reported by the platforms yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {limits
                  .filter((l) => l.ratio != null)
                  .slice(0, 6)
                  .map((l) => (
                    <li key={`${l.accountId}-${l.limitKind}`} className="flex items-center justify-between gap-2">
                      <span className="truncate">{l.personId ? <Link href={`/people/${l.personId}`} className="hover:underline">{l.label}</Link> : l.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-xs text-slate-500">
                          {money(l.usedUsd)} / {money(l.limitUsd)}
                        </span>
                        <StatusBadge status={l.status} />
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

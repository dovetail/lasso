import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { costModel, openFindings, peopleSummary } from "@/analysis/reports";
import { modelBreakdown } from "@/analysis/queries";
import { db } from "@/db/client";
import { githubTeams } from "@/db/schema";
import { SpendChart } from "@/components/charts";
import { FindingList } from "@/components/FindingList";
import { money, PRODUCT_LABEL } from "@/components/format";
import { ModelTable } from "@/components/ModelTable";
import { PeopleTable } from "@/components/PeopleTable";
import { BarList } from "@/components/BarList";
import { Card, PageHeader, Stat } from "@/components/ui";
import { addDays, today } from "@/lib/dates";

export default async function TeamDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const d = db();
  const team = await d.query.githubTeams.findFirst({ where: eq(githubTeams.id, id) });
  if (!team) notFound();
  const asOf = today();
  const scope = { teamId: id };
  const [model, people, models] = await Promise.all([costModel(d, scope, asOf), peopleSummary(d, asOf, scope), modelBreakdown(d, addDays(asOf, -30), asOf, scope)]);
  const findings = await openFindings(d, {
    subjects: [
      { type: "team", keys: [String(id)] },
      { type: "person", keys: people.map((p) => String(p.id)) },
    ],
    limit: 20,
  });
  const month = model.projections[0]!;
  const active = people.filter((p) => p.activeDays30 > 0).length;

  return (
    <>
      <PageHeader title={team.name} subtitle={`GitHub team ${team.slug}${team.parentSlug ? ` · parent ${team.parentSlug}` : ""}`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Usage spend MTD" value={money(model.mtd.cursor + model.mtd.claude)} />
        <Stat label="Projected this month" value={money(month.total)} hint={`${money(month.low)} – ${money(month.high)} incl. seats`} />
        <Stat label="Members" value={people.length} hint={`${active} active in the last 30 days`} />
        <Stat label="Per active member (30d)" value={money(active ? (model.usage30.cursor + model.usage30.claude) / active : null)} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Daily usage spend" className="lg:col-span-2">
          <SpendChart data={model.chart} />
        </Card>
        <Card title="By product" subtitle="Last 30 days">
          <BarList items={model.byProduct.map((p) => ({ label: PRODUCT_LABEL[p.product] ?? p.product, value: p.cost }))} />
        </Card>
      </div>
      <Card title="Members" className="mt-6">
        <PeopleTable people={people} />
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Findings">
          <FindingList items={findings} returnTo={`/teams/${id}`} />
        </Card>
        <Card title="Models" subtitle="Last 30 days">
          <ModelTable rows={models} />
        </Card>
      </div>
    </>
  );
}

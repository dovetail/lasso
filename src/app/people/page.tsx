import { peopleSummary } from "@/analysis/reports";
import { db } from "@/db/client";
import { PeopleTable } from "@/components/PeopleTable";
import { Card, Empty, inputClass, PageHeader } from "@/components/ui";
import { today } from "@/lib/dates";

const SORTS = {
  cost: { label: "Spend (30d)", fn: (a: { cost30: number }, b: { cost30: number }) => b.cost30 - a.cost30 },
  mtd: { label: "Spend (MTD)", fn: (a: { mtd: number }, b: { mtd: number }) => b.mtd - a.mtd },
  active: { label: "Active days", fn: (a: { activeDays30: number }, b: { activeDays30: number }) => b.activeDays30 - a.activeDays30 },
  name: { label: "Name", fn: (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label) },
} as const;

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "cost") as keyof typeof SORTS;
  const filter = sp.filter ?? "all";
  const all = await peopleSummary(db(), today());
  if (!all.length) {
    return (
      <>
        <PageHeader title="People" />
        <Empty title="No people yet">Configure the Cursor, Claude or GitHub connectors, or upload a Claude CSV in Settings.</Empty>
      </>
    );
  }
  let people = all.filter((p) => !q || [p.label, p.login, p.email, ...p.teams].some((s) => s?.toLowerCase().includes(q)));
  if (filter === "inactive") people = people.filter((p) => p.activeDays30 === 0);
  if (filter === "unmatched") people = people.filter((p) => p.matchSources.includes("unmatched"));
  if (filter === "both") people = people.filter((p) => p.platforms.length > 1);
  people = [...people].sort(SORTS[sort].fn as (a: (typeof people)[number], b: (typeof people)[number]) => number);

  return (
    <>
      <PageHeader title="People" subtitle={`${all.length} people across Cursor and Claude, matched to GitHub where possible.`} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, login, email or team" className={`${inputClass} max-w-xs`} />
        <select name="filter" defaultValue={filter} className={`${inputClass} w-auto`}>
          <option value="all">Everyone</option>
          <option value="inactive">Inactive 30d</option>
          <option value="both">Using both tools</option>
          <option value="unmatched">Unmatched accounts</option>
        </select>
        <select name="sort" defaultValue={sort} className={`${inputClass} w-auto`}>
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              Sort: {v.label}
            </option>
          ))}
        </select>
        <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-slate-50">Apply</button>
        <span className="text-sm text-slate-500">{people.length} shown</span>
      </form>
      <Card>
        <PeopleTable people={people} empty="No one matches those filters." />
      </Card>
    </>
  );
}

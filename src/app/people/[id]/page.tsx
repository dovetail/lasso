import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { costModel, limitsView, openFindings, personActivity } from "@/analysis/reports";
import { modelBreakdown } from "@/analysis/queries";
import { db } from "@/db/client";
import { githubTeams, people, personEmails, platformAccounts, teamMemberships } from "@/db/schema";
import { SpendChart } from "@/components/charts";
import { FindingList } from "@/components/FindingList";
import { int, money, PRODUCT_LABEL } from "@/components/format";
import { ModelTable } from "@/components/ModelTable";
import { Badge, Card, Meter, PageHeader, PlatformBadge, Stat, StatusBadge, Table, Td, TextLink, Th } from "@/components/ui";
import { addDays, today } from "@/lib/dates";

export default async function PersonDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const d = db();
  const person = await d.query.people.findFirst({ where: eq(people.id, id) });
  if (!person) notFound();
  const asOf = today();
  const scope = { personId: id };
  const [model, models, emails, accounts, teams, activity, allLimits] = await Promise.all([
    costModel(d, scope, asOf),
    modelBreakdown(d, addDays(asOf, -30), asOf, scope),
    d.select().from(personEmails).where(eq(personEmails.personId, id)),
    d.select().from(platformAccounts).where(eq(platformAccounts.personId, id)),
    d
      .select({ id: githubTeams.id, name: githubTeams.name })
      .from(teamMemberships)
      .innerJoin(githubTeams, eq(githubTeams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.personId, id), isNull(teamMemberships.endedOn))),
    personActivity(d, id, addDays(asOf, -30), asOf),
    limitsView(d, asOf),
  ]);
  const limits = allLimits.filter((l) => l.personId === id);
  const findings = await openFindings(d, {
    status: "all",
    subjects: [
      { type: "person", keys: [String(id)] },
      { type: "account", keys: accounts.map((a) => String(a.id)) },
    ],
    limit: 20,
  });
  const label = person.displayName ?? person.githubLogin ?? person.primaryEmail ?? `Person ${id}`;
  const month = model.projections[0]!;

  return (
    <>
      <PageHeader
        title={label}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {person.githubLogin ? <span>@{person.githubLogin}</span> : <Badge color="amber">not matched to GitHub</Badge>}
            {teams.map((t) => (
              <TextLink key={t.id} href={`/teams/${t.id}`}>
                {t.name}
              </TextLink>
            ))}
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Usage spend MTD" value={money(model.mtd.cursor + model.mtd.claude)} hint={`Cursor ${money(model.mtd.cursor)} · Claude ${money(model.mtd.claude)}`} />
        <Stat label="Last 30 days" value={money(model.usage30.cursor + model.usage30.claude)} />
        <Stat label="Projected this month" value={money(month.total)} hint="incl. seats" />
        <Stat
          label="Limits"
          value={limits.length ? `${limits.filter((l) => l.status === "at_or_over").length} at · ${limits.filter((l) => l.status === "near").length} near` : "none"}
          tone={limits.some((l) => l.status === "at_or_over") ? "bad" : limits.some((l) => l.status === "near") ? "warn" : undefined}
        />
      </div>

      <Card title="Daily usage spend" className="mt-6">
        <SpendChart data={model.chart} height={220} />
      </Card>

      <div className="mt-6 grid gap-6">
        <Card title="Accounts" subtitle="How each platform account was matched to this person">
          <Table head={["Tool", "Account", "Matched by", "Status"]}>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td>
                  <PlatformBadge platform={a.platform} />
                </Td>
                <Td>{a.email ?? a.externalId}</Td>
                <Td className="text-slate-600">{a.matchSource.replace("_", " ")}</Td>
                <Td>{a.isRemoved ? <Badge>removed</Badge> : <Badge color="emerald">active</Badge>}</Td>
              </tr>
            ))}
          </Table>
          {emails.length > 0 && <p className="mt-8 text-xs text-slate-500">Known emails: {emails.map((e) => `${e.email} (${e.source})`).join(", ")}</p>}
        </Card>
        <Card title="Limits">
          <Table head={["Tool", "Limit", <Th key="u" numeric>Used</Th>, <Th key="l" numeric>Limit</Th>, "Usage", <Th key="p" numeric>Projected</Th>, "Status"]} empty="No platform limits apply to this person.">
            {limits.map((l) => (
              <tr key={`${l.accountId}-${l.limitKind}-${l.period}`}>
                <Td>
                  <PlatformBadge platform={l.platform} />
                </Td>
                <Td className="text-slate-600">
                  {l.limitKind.replaceAll("_", " ")} · {l.period}
                </Td>
                <Td numeric>{money(l.usedUsd)}</Td>
                <Td numeric>{money(l.limitUsd)}</Td>
                <Td>
                  <Meter ratio={l.ratio} />
                </Td>
                <Td numeric>{money(l.projected)}</Td>
                <Td>
                  <StatusBadge status={l.status} />
                  {l.cyclesAtLimit >= 2 && <span className="ml-1 text-xs text-rose-700">{l.cyclesAtLimit} cycles</span>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Activity" subtitle="Last 30 days">
          <Table
            head={["Product", <Th key="a" numeric>Active days</Th>, <Th key="s" numeric>Sessions</Th>, <Th key="m" numeric>Messages</Th>, <Th key="l" numeric>Lines accepted</Th>, <Th key="c" numeric>Commits</Th>, <Th key="p" numeric>PRs</Th>]}
            empty="No activity in the last 30 days."
          >
            {activity.map((a) => (
              <tr key={a.product}>
                <Td>{PRODUCT_LABEL[a.product] ?? a.product}</Td>
                <Td numeric>{a.activeDays}</Td>
                <Td numeric>{a.sessions ? int(a.sessions) : "–"}</Td>
                <Td numeric>{a.messages ? int(a.messages) : "–"}</Td>
                <Td numeric>{a.linesAccepted ? int(a.linesAccepted) : "–"}</Td>
                <Td numeric>{a.commits ? int(a.commits) : "–"}</Td>
                <Td numeric>{a.prs ? int(a.prs) : "–"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Models" subtitle="Last 30 days">
          <ModelTable rows={models} />
        </Card>
      </div>

      <Card title="Findings" className="mt-6">
        <FindingList items={findings} returnTo={`/people/${id}`} />
      </Card>
    </>
  );
}

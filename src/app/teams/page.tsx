import { teamSummary } from "@/analysis/queries";
import { db } from "@/db/client";
import { money, pct } from "@/components/format";
import { Card, Empty, PageHeader, Table, Td, TextLink, Th } from "@/components/ui";
import { today } from "@/lib/dates";

export default async function Teams() {
  const teams = await teamSummary(db(), today());
  if (!teams.length) {
    return (
      <>
        <PageHeader title="Teams" />
        <Empty title="No GitHub teams yet">Set GITHUB_ORG and a GitHub token or app, then run a sync. Teams and membership come from your GitHub organisation.</Empty>
      </>
    );
  }
  const total = teams.reduce((a, t) => a + t.cost30, 0);
  return (
    <>
      <PageHeader title="Teams" subtitle="GitHub teams. Spend is attributed by membership on the day it happened, so people in several teams count towards each." />
      <Card>
        <Table
          head={[
            "Team",
            <Th key="m" numeric>Members</Th>,
            <Th key="a" numeric>Active 30d</Th>,
            <Th key="ad" numeric>Adoption</Th>,
            <Th key="c" numeric>Spend 30d</Th>,
            <Th key="pp" numeric>Per member</Th>,
            <Th key="mtd" numeric>MTD</Th>,
            <Th key="s" numeric>Share</Th>,
          ]}
        >
          {teams.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50">
              <Td>
                <TextLink href={`/teams/${t.id}`}>{t.name}</TextLink>
                <div className="text-xs text-slate-500">{t.slug}</div>
              </Td>
              <Td numeric>{t.members}</Td>
              <Td numeric>{t.active30}</Td>
              <Td numeric>{pct(t.members ? t.active30 / t.members : null)}</Td>
              <Td numeric className="font-medium">{money(t.cost30)}</Td>
              <Td numeric>{money(t.members ? t.cost30 / t.members : null)}</Td>
              <Td numeric>{money(t.mtd)}</Td>
              <Td numeric>{pct(total ? t.cost30 / total : null)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

import type { PersonRow } from "@/analysis/queries";
import { money } from "./format";
import { Badge, PlatformBadge, Table, Td, TextLink, Th } from "./ui";

export function PeopleTable({ people, empty }: { people: PersonRow[]; empty?: string }) {
  return (
    <Table
      empty={empty}
      head={[
        "Person",
        "Teams",
        "Tools",
        <Th key="c" numeric>Cursor 30d</Th>,
        <Th key="cl" numeric>Claude 30d</Th>,
        <Th key="t" numeric>Total 30d</Th>,
        <Th key="m" numeric>MTD</Th>,
        <Th key="a" numeric>Active days</Th>,
        "Top model",
      ]}
    >
      {people.map((p) => (
        <tr key={p.id} className="hover:bg-slate-50">
          <Td>
            <TextLink href={`/people/${p.id}`}>{p.label}</TextLink>
            <div className="text-xs text-slate-500">{p.login ? `@${p.login}` : p.email}</div>
          </Td>
          <Td className="max-w-56 truncate text-slate-600">{p.teams.join(", ") || <span className="text-slate-400">–</span>}</Td>
          <Td>
            <div className="flex gap-1">
              {p.platforms.map((pl) => (
                <PlatformBadge key={pl} platform={pl} />
              ))}
              {p.matchSources.includes("unmatched") && <Badge color="amber">unmatched</Badge>}
            </div>
          </Td>
          <Td numeric>{money(p.cursor30)}</Td>
          <Td numeric>{money(p.claude30)}</Td>
          <Td numeric className="font-medium">{money(p.cost30)}</Td>
          <Td numeric>{money(p.mtd)}</Td>
          <Td numeric>{p.activeDays30}</Td>
          <Td className="text-xs text-slate-600">{p.topModel ?? "–"}</Td>
        </tr>
      ))}
    </Table>
  );
}

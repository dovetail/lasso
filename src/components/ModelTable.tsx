import type { ModelRow } from "@/analysis/queries";
import { compact, money } from "./format";
import { PlatformBadge, Table, Td, Th } from "./ui";

export function ModelTable({ rows, limit = 15 }: { rows: ModelRow[]; limit?: number }) {
  return (
    <Table
      empty="No model usage recorded."
      head={[
        "Model",
        "Tool",
        <Th key="c" numeric>Cost</Th>,
        <Th key="r" numeric>Requests</Th>,
        <Th key="t" numeric>Tokens</Th>,
        <Th key="tr" numeric>Tokens/req</Th>,
        <Th key="p" numeric>People</Th>,
      ]}
    >
      {rows.slice(0, limit).map((m) => (
        <tr key={`${m.platform}-${m.model}`}>
          <Td className="font-mono text-xs">{m.model}</Td>
          <Td>
            <PlatformBadge platform={m.platform} />
          </Td>
          <Td numeric className="font-medium">{money(m.cost)}</Td>
          <Td numeric>{compact(m.requests)}</Td>
          <Td numeric>{compact(m.tokens)}</Td>
          <Td numeric>{m.requests ? compact(m.tokens / m.requests) : "–"}</Td>
          <Td numeric>{m.people}</Td>
        </tr>
      ))}
    </Table>
  );
}

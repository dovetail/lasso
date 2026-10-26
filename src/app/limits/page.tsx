import Link from "next/link";
import { budgetsView, increaseRequests, limitsView } from "@/analysis/reports";
import { peopleSummary, teamSummary } from "@/analysis/queries";
import { db } from "@/db/client";
import { addBudgetAction, deleteBudgetAction } from "@/app/actions";
import { Flash } from "@/components/Flash";
import { money } from "@/components/format";
import { Badge, Button, Card, Field, inputClass, Meter, PageHeader, PlatformBadge, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { today } from "@/lib/dates";

function Who({ personId, label }: { personId: number | null; label: string }) {
  return personId ? (
    <Link href={`/people/${personId}`} className="font-medium hover:underline">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

export default async function Limits({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const show = sp.show ?? "pressure";
  const d = db();
  const asOf = today();
  const [limits, budgets, requests, teams, people] = await Promise.all([limitsView(d, asOf), budgetsView(d, asOf), increaseRequests(d, asOf), teamSummary(d, asOf), peopleSummary(d, asOf)]);
  const withLimit = limits.filter((l) => l.limitUsd != null);
  const over = withLimit.filter((l) => l.status === "at_or_over");
  const near = withLimit.filter((l) => l.status === "near");
  const willExceed = withLimit.filter((l) => l.willExceed && l.status !== "at_or_over");
  const repeat = withLimit.filter((l) => l.cyclesAtLimit >= 2 || l.increaseRequests90 >= 2);
  const shown = show === "all" ? limits : show === "repeat" ? repeat : withLimit.filter((l) => l.status === "at_or_over" || l.status === "near" || l.willExceed);

  return (
    <>
      <PageHeader title="Limits & budgets" subtitle="Per-user spend limits reported by Cursor and Claude, plus budgets you define in Lasso." />
      <Flash params={sp} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="At or over limit" value={over.length} tone={over.length ? "bad" : undefined} />
        <Stat label="Near limit" value={near.length} tone={near.length ? "warn" : undefined} hint="Above the near-limit threshold" />
        <Stat label="On track to hit limit" value={willExceed.length} hint="Projected to reach the limit by cycle end" tone={willExceed.length ? "warn" : undefined} />
        <Stat label="Repeatedly at limit" value={repeat.length} hint="2+ of the last 3 cycles, or 2+ increase requests in 90 days" tone={repeat.length ? "bad" : undefined} />
      </div>

      <Card
        title="Platform limits"
        className="mt-6"
        actions={
          <div className="flex gap-1 text-xs">
            {[
              ["pressure", "Under pressure"],
              ["repeat", "Repeat offenders"],
              ["all", "All"],
            ].map(([k, label]) => (
              <Link key={k} href={`/limits?show=${k}`} className={`rounded-md px-2 py-1 ${show === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </Link>
            ))}
          </div>
        }
      >
        <Table
          empty={limits.length ? "No one is near their limit." : "No limits reported yet. Cursor reports per-user on-demand limits; Claude needs an Admin API key with read:spend_limits."}
          head={["Person", "Tool", "Limit", "Cycle", <Th key="u" numeric>Used</Th>, <Th key="l" numeric>Limit</Th>, "Usage", <Th key="p" numeric>Projected</Th>, "Status", "History"]}
        >
          {shown.map((l) => (
            <tr key={`${l.accountId}-${l.limitKind}-${l.period}`} className="hover:bg-slate-50">
              <Td>
                <Who personId={l.personId} label={l.label} />
              </Td>
              <Td>
                <PlatformBadge platform={l.platform} />
              </Td>
              <Td className="text-slate-600">
                {l.limitKind.replaceAll("_", " ")}
                {l.source && <div className="text-xs text-slate-400">{l.source}</div>}
              </Td>
              <Td className="text-xs text-slate-600">
                {l.cycleStart} → {l.cycleEnd}
              </Td>
              <Td numeric>{money(l.usedUsd)}</Td>
              <Td numeric>{money(l.limitUsd)}</Td>
              <Td>
                <Meter ratio={l.ratio} />
              </Td>
              <Td numeric className={l.willExceed ? "text-rose-700" : undefined}>
                {money(l.projected)}
              </Td>
              <Td>
                <StatusBadge status={l.status} />
              </Td>
              <Td className="text-xs text-slate-600">
                {l.cyclesAtLimit > 0 && <div>{l.cyclesAtLimit} of last 3 cycles at limit</div>}
                {l.increaseRequests90 > 0 && <div>{l.increaseRequests90} increase requests (90d)</div>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Budgets" subtitle="Compared against usage spend this month. Seats are not included." className="lg:col-span-2">
          <div id="budgets" />
          <Table head={["Scope", <Th key="b" numeric>Budget</Th>, <Th key="u" numeric>Used MTD</Th>, "Usage", <Th key="p" numeric>Projected</Th>, "Status", ""]} empty="No budgets yet. Add one on the right.">
            {budgets.map((b) => (
              <tr key={b.id}>
                <Td>
                  <Badge>{b.scopeType}</Badge> <span className="ml-1 font-medium">{b.label}</span>
                  {b.note && <div className="text-xs text-slate-500">{b.note}</div>}
                </Td>
                <Td numeric>{money(b.amountUsd)}</Td>
                <Td numeric>{money(b.usedUsd)}</Td>
                <Td>
                  <Meter ratio={b.ratio} />
                </Td>
                <Td numeric className={b.willExceed ? "text-rose-700" : undefined}>
                  {money(b.projectedUsd)}
                </Td>
                <Td>
                  <StatusBadge status={b.status} />
                  {b.willExceed && b.status !== "at_or_over" && <span className="ml-1 text-xs text-rose-700">on track to exceed</span>}
                </Td>
                <Td>
                  <form action={deleteBudgetAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="text-xs text-slate-500 hover:text-rose-700">Remove</button>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add a monthly budget">
          <form action={addBudgetAction} className="space-y-3">
            <Field label="Applies to">
              <select name="target" className={inputClass} defaultValue="org">
                <option value="org">Whole organisation</option>
                <optgroup label="Teams">
                  {teams.map((t) => (
                    <option key={`t${t.id}`} value={`team:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="People">
                  {people.map((p) => (
                    <option key={`p${p.id}`} value={`person:${p.id}`}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field label="Amount (USD per month)">
              <input name="amountUsd" type="number" min={1} step="any" required className={inputClass} />
            </Field>
            <Field label="Note">
              <input name="note" className={inputClass} placeholder="Optional" />
            </Field>
            <Button>Add budget</Button>
          </form>
        </Card>
      </div>

      <Card title="Limit increase requests" subtitle="Last 90 days. Claude Enterprise only." className="mt-6">
        <Table head={["Person", "Tool", "Requested", "Status", <Th key="s" numeric>Spend at request</Th>, <Th key="l" numeric>Limit at request</Th>]} empty="No increase requests in the last 90 days.">
          {requests.map((r) => (
            <tr key={r.id}>
              <Td>
                <Who personId={r.personId} label={r.label} />
              </Td>
              <Td>
                <PlatformBadge platform={r.platform} />
              </Td>
              <Td className="text-slate-600">{r.requestedAt.slice(0, 10)}</Td>
              <Td>
                <Badge color={r.status === "approved" ? "emerald" : r.status === "pending" ? "amber" : "slate"}>{r.status}</Badge>
              </Td>
              <Td numeric>{money(r.spendUsd)}</Td>
              <Td numeric>{money(r.limitUsd)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

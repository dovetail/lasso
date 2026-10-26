import Link from "next/link";
import { setFindingStatusAction } from "@/app/actions";
import { money } from "./format";
import { Badge, SeverityBadge } from "./ui";

export interface FindingItem {
  id: number;
  ruleId: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  monthlyImpactUsd: number | null;
  firstSeenOn: string;
  lastSeenOn: string;
}

export const RULE_LABEL: Record<string, string> = {
  idle_seat: "Idle seat",
  tool_overlap: "Tool overlap",
  expensive_model_simple_work: "Expensive model, light work",
  spend_spike: "Spend spike",
  declining_adoption: "Declining adoption",
  spend_concentration: "Spend concentration",
  unmatched_accounts: "Unmatched accounts",
  repeated_limit_hits: "Repeated limit hits",
};

export function FindingList({ items, returnTo, actions = true, links }: { items: FindingItem[]; returnTo: string; actions?: boolean; links?: Map<number, string> }) {
  if (!items.length) return <p className="text-sm text-slate-500">No findings. Nice.</p>;
  return (
    <ul className="-my-3 divide-y divide-slate-100">
      {items.map((f) => (
        <li key={f.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={f.severity} />
              <Badge>{RULE_LABEL[f.ruleId] ?? f.ruleId}</Badge>
              {f.status !== "open" && <Badge color="slate">{f.status}</Badge>}
              {f.monthlyImpactUsd != null && f.monthlyImpactUsd > 0 && <span className="text-xs font-medium text-emerald-700">~{money(f.monthlyImpactUsd, { cents: false })}/mo</span>}
            </div>
            <div className="mt-1 text-sm font-medium">
              {links?.get(f.id) ? (
                <Link href={links.get(f.id)!} className="hover:underline">
                  {f.title}
                </Link>
              ) : (
                f.title
              )}
            </div>
            <div className="mt-0.5 text-sm text-slate-600">{f.detail}</div>
            <div className="mt-1 text-xs text-slate-400">
              First seen {f.firstSeenOn}, last seen {f.lastSeenOn}
            </div>
          </div>
          {actions && (
            <form action={setFindingStatusAction} className="flex shrink-0 gap-1">
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {f.status === "open" ? (
                <>
                  <button name="status" value="muted" className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                    Mute
                  </button>
                  <button name="status" value="resolved" className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                    Resolve
                  </button>
                </>
              ) : (
                <button name="status" value="open" className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                  Reopen
                </button>
              )}
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

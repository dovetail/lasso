import Link from "next/link";
import { money } from "./format";

export function BarList({ items, color = "bg-indigo-500" }: { items: Array<{ label: string; value: number; href?: string; sub?: string }>; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-slate-500">No spend recorded yet.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">
              {i.href ? (
                <Link href={i.href} className="font-medium hover:underline">
                  {i.label}
                </Link>
              ) : (
                <span className="font-medium">{i.label}</span>
              )}
              {i.sub && <span className="ml-2 text-xs text-slate-500">{i.sub}</span>}
            </span>
            <span className="tabular shrink-0 text-slate-700">{money(i.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

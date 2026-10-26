"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/teams", label: "Teams" },
  { href: "/people", label: "People" },
  { href: "/costs", label: "Costs & projections" },
  { href: "/limits", label: "Limits & budgets" },
  { href: "/findings", label: "Findings" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ findingsCount }: { findingsCount: number }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
            }`}
          >
            {item.label}
            {item.href === "/findings" && findingsCount > 0 && (
              <span className="rounded-full bg-amber-400/90 px-1.5 text-xs font-semibold text-slate-900">{findingsCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

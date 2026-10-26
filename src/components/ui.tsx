import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, className, actions }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cx(
          "tabular mt-1 text-2xl font-semibold",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-rose-600",
          tone === "good" && "text-emerald-600",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700",
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-800",
  emerald: "bg-emerald-100 text-emerald-800",
  indigo: "bg-indigo-100 text-indigo-800",
  cursor: "bg-slate-900 text-white",
  claude: "bg-[#f6e3db] text-[#9a4a2c]",
};

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: keyof typeof BADGE }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE[color])}>{children}</span>;
}

export function PlatformBadge({ platform }: { platform: string }) {
  return <Badge color={platform === "cursor" ? "cursor" : "claude"}>{platform === "cursor" ? "Cursor" : "Claude"}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const color = severity === "critical" ? "rose" : severity === "warning" ? "amber" : "indigo";
  return <Badge color={color}>{severity}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, keyof typeof BADGE]> = {
    none: ["no limit", "slate"],
    ok: ["ok", "emerald"],
    near: ["near limit", "amber"],
    at_or_over: ["at limit", "rose"],
  };
  const [label, color] = map[status] ?? [status, "slate"];
  return <Badge color={color}>{label}</Badge>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-5 py-8 text-center text-slate-500">
                {empty ?? "Nothing to show yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, numeric }: { children: ReactNode; className?: string; numeric?: boolean }) {
  return <td className={cx("whitespace-nowrap px-5 py-2.5", numeric && "tabular text-right", className)}>{children}</td>;
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return <span className={cx(numeric && "block text-right")}>{children}</span>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-indigo-700 hover:underline">
      {children}
    </Link>
  );
}

export function Button({ children, variant = "primary", type = "submit", name, value }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; type?: "submit" | "button"; name?: string; value?: string }) {
  return (
    <button
      type={type}
      name={name}
      value={value}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition-colors disabled:opacity-50",
        variant === "primary" && "bg-indigo-600 text-white hover:bg-indigo-500",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        variant === "danger" && "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
        variant === "ghost" && "text-slate-600 shadow-none hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Meter({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="text-slate-400">–</span>;
  const w = Math.min(100, Math.round(ratio * 100));
  const color = ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={cx("h-full rounded-full", color)} style={{ width: `${w}%` }} />
      </div>
      <span className="tabular text-xs text-slate-600">{Math.round(ratio * 100)}%</span>
    </div>
  );
}

"use client";

import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const CURSOR = "#0f172a";
const CLAUDE = "#d97757";
const FORECAST = "#6366f1";

const usd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
const usdFull = (v: unknown) => `$${Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface SpendPoint {
  day: string;
  cursor: number | null;
  claude: number | null;
  forecast: number | null;
}

export function SpendChart({ data, height = 280 }: { data: SpendPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="day" tickFormatter={dayLabel} minTickGap={32} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={usd} width={52} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={usdFull} labelFormatter={(d) => dayLabel(String(d))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area isAnimationActive={false} type="monotone" dataKey="cursor" name="Cursor" stackId="s" stroke={CURSOR} fill={CURSOR} fillOpacity={0.75} />
        <Area isAnimationActive={false} type="monotone" dataKey="claude" name="Claude" stackId="s" stroke={CLAUDE} fill={CLAUDE} fillOpacity={0.75} />
        <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="Forecast" stroke={FORECAST} strokeDasharray="5 4" dot={false} strokeWidth={2} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyChart({ data, height = 240 }: { data: Array<{ month: string; cursor: number; claude: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={usd} width={52} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={usdFull} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="cursor" name="Cursor" stackId="m" fill={CURSOR} />
        <Bar isAnimationActive={false} dataKey="claude" name="Claude" stackId="m" fill={CLAUDE} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

import { costModel, scenario } from "@/analysis/reports";
import { modelBreakdown } from "@/analysis/queries";
import { CHEAPER_MODEL_COST_RATIO, type ScenarioParams } from "@/analysis/projection";
import { db } from "@/db/client";
import { MonthlyChart, SpendChart } from "@/components/charts";
import { money, pct } from "@/components/format";
import { ModelTable } from "@/components/ModelTable";
import { Button, Card, Field, inputClass, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { addDays, today } from "@/lib/dates";

function intParam(v: string | undefined) {
  const n = Math.trunc(Number(v ?? 0));
  return Number.isFinite(n) ? Math.max(-10_000, Math.min(10_000, n)) : 0;
}

export default async function Costs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const params: ScenarioParams = {
    addCursorSeats: intParam(sp.addCursor),
    addClaudeSeats: intParam(sp.addClaude),
    moveClaudeToCursor: intParam(sp.move),
    removeIdleSeats: sp.idle === "on",
    shiftExpensiveShare: Math.max(0, Math.min(100, intParam(sp.shift))) / 100,
  };
  const d = db();
  const asOf = today();
  const [model, models, sim] = await Promise.all([costModel(d, {}, asOf), modelBreakdown(d, addDays(asOf, -30), asOf), scenario(d, params)]);
  const changed = sim.delta !== 0;

  return (
    <>
      <PageHeader
        title="Costs & projections"
        subtitle={`Usage spend is what the platforms report. Seat cost uses your configured prices (Cursor ${money(model.settings.seatPriceUsd.cursor)}, Claude ${money(model.settings.seatPriceUsd.claude)} per seat per month).`}
      />

      <Card title="Projections" subtitle={`Actuals to yesterday, plus a forecast for the rest of the period. Range is an ~80% interval. Method: ${model.forecastMethod === "trend+seasonality" ? "damped trend with weekday seasonality" : model.forecastMethod === "mean" ? "recent average" : "not enough data"} on ${model.historyDays} days of history.`}>
        <Table
          head={[
            "Period",
            <Th key="a" numeric>Usage to date</Th>,
            <Th key="f" numeric>Usage forecast</Th>,
            <Th key="s" numeric>Seats</Th>,
            <Th key="t" numeric>Projected total</Th>,
            <Th key="r" numeric>Range</Th>,
          ]}
        >
          {model.projections.map((p) => (
            <tr key={p.label}>
              <Td className="font-medium">
                {p.label}
                <div className="text-xs font-normal text-slate-500">
                  {p.from} to {addDays(p.toExclusive, -1)}
                </div>
              </Td>
              <Td numeric>{money(p.actualUsage)}</Td>
              <Td numeric>{money(p.forecastUsage)}</Td>
              <Td numeric>{money(p.seatCost)}</Td>
              <Td numeric className="font-semibold">{money(p.total)}</Td>
              <Td numeric className="text-slate-500">
                {money(p.low)} – {money(p.high)}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Daily usage spend" subtitle="Last 90 days and forecast to month end">
          <SpendChart data={model.chart} height={240} />
        </Card>
        <Card title="Monthly usage spend" subtitle="Usage only, excludes seats">
          <MonthlyChart data={model.monthly} />
        </Card>
      </div>

      <Card title="What if?" subtitle="Monthly run rate based on the last 30 days. Added people are assumed to spend like today's average active user." className="mt-6">
        <div className="grid gap-6 lg:grid-cols-5">
          <form className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Add Cursor seats" hint="Negative to remove">
                <input name="addCursor" type="number" defaultValue={params.addCursorSeats} className={inputClass} />
              </Field>
              <Field label="Add Claude seats" hint="Negative to remove">
                <input name="addClaude" type="number" defaultValue={params.addClaudeSeats} className={inputClass} />
              </Field>
            </div>
            <Field label="Move people from Claude to Cursor" hint="Negative moves Cursor users to Claude">
              <input name="move" type="number" defaultValue={params.moveClaudeToCursor} className={inputClass} />
            </Field>
            <Field label="Shift expensive-model usage to cheaper models (%)" hint={`Assumes cheaper models cost ${pct(CHEAPER_MODEL_COST_RATIO)} as much. Expensive models match the pattern in Settings.`}>
              <input name="shift" type="number" min={0} max={100} defaultValue={Math.round(params.shiftExpensiveShare * 100)} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="idle" defaultChecked={params.removeIdleSeats} className="rounded" />
              Reclaim idle seats ({sim.ctx.idleSeats.cursor} Cursor, {sim.ctx.idleSeats.claude} Claude)
            </label>
            <div className="flex gap-2">
              <Button>Calculate</Button>
              <a href="/costs" className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                Reset
              </a>
            </div>
          </form>
          <div className="grid content-start gap-4 sm:grid-cols-3 lg:col-span-3">
            <Stat label="Current monthly" value={money(sim.base.total)} hint={`${money(sim.base.seatCost)} seats + ${money(sim.base.usageCost)} usage`} />
            <Stat label="Scenario monthly" value={money(sim.next.total)} hint={`${money(sim.next.seatCost)} seats + ${money(sim.next.usageCost)} usage`} />
            <Stat
              label="Difference"
              value={`${sim.delta > 0 ? "+" : ""}${money(sim.delta)}`}
              tone={!changed ? undefined : sim.delta > 0 ? "warn" : "good"}
              hint={changed ? `${sim.delta > 0 ? "+" : ""}${money(sim.delta * 12)} per year` : "Adjust the inputs to compare"}
            />
            <div className="text-xs text-slate-500 sm:col-span-3">
              Inputs: {sim.ctx.seats.cursor} Cursor and {sim.ctx.seats.claude} Claude seats; {sim.ctx.activeUsers30.cursor} and {sim.ctx.activeUsers30.claude} active users; {money(sim.ctx.expensiveModelCost30)} spent on
              expensive models in the last 30 days.
            </div>
          </div>
        </div>
      </Card>

      <Card title="Models" subtitle="Last 30 days, all tools" className="mt-6">
        <ModelTable rows={models} limit={25} />
      </Card>
    </>
  );
}

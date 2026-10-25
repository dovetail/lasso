import type { DB } from "@/db/client";
import { budgets, limitEvents } from "@/db/schema";
import { endOfMonthExclusive, startOfMonth, today } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { crossedThresholds } from "./limits";
import { currentLimits, scopeSpend } from "./queries";

/** Record threshold crossings for platform limits and org-defined budgets. */
export async function recordLimitEvents(db: DB) {
  const { thresholds } = await getSettings(db);
  const values: Array<typeof limitEvents.$inferInsert> = [];

  for (const l of await currentLimits(db)) {
    for (const threshold of crossedThresholds(l.usedUsd, l.limitUsd, thresholds.nearLimitRatio)) {
      values.push({
        subjectType: "account",
        subjectId: l.accountId,
        limitRef: `${l.platform}:${l.limitKind}:${l.period}`,
        threshold,
        cycleStart: l.cycleStart,
      });
    }
  }

  const day = today();
  const monthStart = startOfMonth(day);
  for (const b of await db.select().from(budgets)) {
    const spent = await scopeSpend(db, b.scopeType, b.scopeId, monthStart, endOfMonthExclusive(day));
    for (const threshold of crossedThresholds(spent, b.amountUsd, thresholds.nearLimitRatio)) {
      values.push({ subjectType: "budget", subjectId: b.id, limitRef: `budget:${b.id}`, threshold, cycleStart: monthStart });
    }
  }

  if (values.length) await db.insert(limitEvents).values(values).onConflictDoNothing();
  return values.length;
}

"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/current";
import { db } from "@/db/client";
import { budgets, findings, identityOverrides } from "@/db/schema";
import { importClaudeCsv, refreshDerived } from "@/ingest/sync";
import { getSettings, saveSettings, settingsSchema } from "@/lib/settings";
import { enqueueSync } from "@/server/jobs";

function back(path: string, msg: string, kind: "ok" | "error" = "ok"): never {
  const [base, hash] = path.split("#");
  const sep = base!.includes("?") ? "&" : "?";
  redirect(`${base}${sep}${kind}=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`);
}

function num(form: FormData, key: string): number {
  const v = Number(form.get(key));
  if (!Number.isFinite(v)) throw new Error(`Invalid number for ${key}`);
  return v;
}

export async function syncNowAction() {
  await requireUser();
  await enqueueSync();
  back("/settings", "Sync queued. Refresh in a minute to see results.");
}

export async function saveSettingsAction(form: FormData) {
  await requireUser();
  const current = await getSettings(db());
  const next = {
    seatPriceUsd: { cursor: num(form, "seat_cursor"), claude: num(form, "seat_claude") },
    seatPricesConfirmed: true,
    thresholds: {
      nearLimitRatio: num(form, "nearLimitRatio") / 100,
      idleSeatDays: num(form, "idleSeatDays"),
      overlapDominantShare: num(form, "overlapDominantShare") / 100,
      expensiveModelPattern: String(form.get("expensiveModelPattern") ?? current.thresholds.expensiveModelPattern),
      expensiveModelMaxTokensPerRequest: num(form, "expensiveModelMaxTokensPerRequest"),
      expensiveModelMinRequests: num(form, "expensiveModelMinRequests"),
      spikeZScore: num(form, "spikeZScore"),
      spikeMinUsd: num(form, "spikeMinUsd"),
      concentrationShare: num(form, "concentrationShare") / 100,
      concentrationMinTeamUsd: num(form, "concentrationMinTeamUsd"),
      adoptionDropShare: num(form, "adoptionDropShare") / 100,
    },
  };
  try {
    new RegExp(next.thresholds.expensiveModelPattern, "i");
  } catch {
    back("/settings", "Expensive model pattern is not a valid regular expression.", "error");
  }
  const parsed = settingsSchema.safeParse(next);
  if (!parsed.success) back("/settings", `Invalid settings: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`, "error");
  await saveSettings(db(), parsed.data);
  await refreshDerived(db());
  back("/settings", "Settings saved and findings recalculated.");
}

export async function addOverrideAction(form: FormData) {
  const user = await requireUser();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const login = String(form.get("githubLogin") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!email.includes("@") || !login) back("/settings#identity", "Enter an email and a GitHub login.", "error");
  await db()
    .insert(identityOverrides)
    .values({ email, githubLogin: login, createdBy: user.email ?? user.sub })
    .onConflictDoUpdate({ target: identityOverrides.email, set: { githubLogin: login, updatedAt: new Date() } });
  await refreshDerived(db());
  back("/settings#identity", `Mapped ${email} to @${login}.`);
}

export async function deleteOverrideAction(form: FormData) {
  await requireUser();
  await db().delete(identityOverrides).where(eq(identityOverrides.id, num(form, "id")));
  await refreshDerived(db());
  back("/settings#identity", "Override removed.");
}

export async function addBudgetAction(form: FormData) {
  await requireUser();
  const [scopeType, rawId] = String(form.get("target") ?? "org").split(":") as ["org" | "team" | "person", string | undefined];
  if (!["org", "team", "person"].includes(scopeType)) back("/limits#budgets", "Invalid scope.", "error");
  const scopeId = scopeType === "org" ? null : Number(rawId);
  if (scopeId !== null && !Number.isInteger(scopeId)) back("/limits#budgets", "Invalid scope.", "error");
  const amountUsd = num(form, "amountUsd");
  if (amountUsd <= 0) back("/limits#budgets", "Budget must be greater than zero.", "error");
  await db().insert(budgets).values({ scopeType, scopeId, amountUsd, note: String(form.get("note") ?? "") || null });
  await refreshDerived(db());
  back("/limits#budgets", "Budget added.");
}

export async function deleteBudgetAction(form: FormData) {
  await requireUser();
  await db().delete(budgets).where(eq(budgets.id, num(form, "id")));
  back("/limits#budgets", "Budget removed.");
}

export async function setFindingStatusAction(form: FormData) {
  await requireUser();
  const status = String(form.get("status")) as "open" | "muted" | "resolved";
  if (!["open", "muted", "resolved"].includes(status)) back("/findings", "Invalid status.", "error");
  const id = num(form, "id");
  try {
    await db().update(findings).set({ status, updatedAt: new Date() }).where(eq(findings.id, id));
  } catch {
    back(String(form.get("returnTo") ?? "/findings"), "An open finding for the same subject already exists.", "error");
  }
  back(String(form.get("returnTo") ?? "/findings"), `Finding ${status === "open" ? "reopened" : status}.`);
}

export async function uploadClaudeCsvAction(form: FormData) {
  await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back("/settings#claude-csv", "Choose a CSV file to upload.", "error");
  const result = await importClaudeCsv(await file.text());
  if (!result.ok) {
    const why = result.error ?? result.errors.slice(0, 3).join("; ") ?? "no usable rows";
    back("/settings#claude-csv", `Import failed: ${why}`, "error");
  }
  const warn = result.errors.length ? ` ${result.errors.length} rows skipped.` : "";
  back("/settings#claude-csv", `Imported ${result.rows} rows.${warn}`);
}

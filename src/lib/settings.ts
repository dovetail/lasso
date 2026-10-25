import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { appSettings } from "@/db/schema";

export const settingsSchema = z.object({
  seatPriceUsd: z.object({
    cursor: z.number().min(0),
    claude: z.number().min(0),
  }),
  seatPricesConfirmed: z.boolean(),
  thresholds: z.object({
    nearLimitRatio: z.number().min(0.1).max(1),
    idleSeatDays: z.number().int().min(7),
    overlapDominantShare: z.number().min(0.5).max(1),
    expensiveModelPattern: z.string(),
    expensiveModelMaxTokensPerRequest: z.number().int().min(100),
    expensiveModelMinRequests: z.number().int().min(1),
    spikeZScore: z.number().min(1),
    spikeMinUsd: z.number().min(0),
    concentrationShare: z.number().min(0.1).max(1),
    concentrationMinTeamUsd: z.number().min(0),
    adoptionDropShare: z.number().min(0.01).max(1),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  seatPriceUsd: { cursor: 40, claude: 30 },
  seatPricesConfirmed: false,
  thresholds: {
    nearLimitRatio: 0.8,
    idleSeatDays: 30,
    overlapDominantShare: 0.9,
    expensiveModelPattern: "opus|o1|o3(?!-mini)|-high|thinking|max",
    expensiveModelMaxTokensPerRequest: 2000,
    expensiveModelMinRequests: 20,
    spikeZScore: 3,
    spikeMinUsd: 25,
    concentrationShare: 0.4,
    concentrationMinTeamUsd: 200,
    adoptionDropShare: 0.15,
  },
};

const KEY = "settings";

export async function getSettings(db: DB): Promise<Settings> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, KEY) });
  if (!row) return DEFAULT_SETTINGS;
  const stored = row.value as Partial<Settings>;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    seatPriceUsd: { ...DEFAULT_SETTINGS.seatPriceUsd, ...stored.seatPriceUsd },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...stored.thresholds },
  };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: DB, value: Settings) {
  const parsed = settingsSchema.parse(value);
  await db
    .insert(appSettings)
    .values({ key: KEY, value: parsed })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed, updatedAt: new Date() } });
}

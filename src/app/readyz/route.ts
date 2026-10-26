import { sqlClient } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sqlClient()`select 1`;
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { baseUrl } from "@/auth/oidc";
import { SESSION_COOKIE } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/signed-out", baseUrl(req)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

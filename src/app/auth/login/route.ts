import { NextResponse } from "next/server";
import { baseUrl, client, oidcConfig, oidcConfigured } from "@/auth/oidc";
import { OIDC_COOKIE, signTransient } from "@/auth/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const e = env();
  if (e.LASSO_AUTH_MODE === "none") return NextResponse.redirect(new URL("/", baseUrl(req)));
  if (!oidcConfigured()) {
    return new NextResponse("OIDC is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET, or LASSO_AUTH_MODE=none for local use.", { status: 500 });
  }
  let config;
  try {
    config = await oidcConfig();
  } catch (err) {
    console.error("[lasso] OIDC discovery failed:", err);
    return new NextResponse("Could not reach the OIDC issuer. Check OIDC_ISSUER and the server logs.", { status: 502 });
  }
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const next = new URL(req.url).searchParams.get("next") ?? "/";
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    scope: e.OIDC_SCOPES,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(OIDC_COOKIE, await signTransient({ verifier, state, next: next.startsWith("/") ? next : "/" }, e.LASSO_SESSION_SECRET!), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl(req).startsWith("https"),
    path: "/auth",
    maxAge: 600,
  });
  return res;
}

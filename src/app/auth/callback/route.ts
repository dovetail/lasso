import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { baseUrl, client, emailAllowed, oidcConfig } from "@/auth/oidc";
import { OIDC_COOKIE, SESSION_COOKIE, sessionMaxAge, signSession, verifyTransient } from "@/auth/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const e = env();
  const secret = e.LASSO_SESSION_SECRET!;
  const jar = await cookies();
  const transient = await verifyTransient(jar.get(OIDC_COOKIE)?.value, secret);
  if (!transient) return new NextResponse("Sign-in expired. Please try again.", { status: 400 });

  const base = baseUrl(req);
  const incoming = new URL(req.url);
  const currentUrl = new URL(`${base}/auth/callback${incoming.search}`);
  try {
    const tokens = await client.authorizationCodeGrant(await oidcConfig(), currentUrl, {
      pkceCodeVerifier: transient.verifier,
      expectedState: transient.state,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("No ID token returned");
    const email = (claims.email as string | undefined)?.toLowerCase() ?? null;
    if (!emailAllowed(email)) return new NextResponse(`Access denied for ${email ?? "unknown email"}.`, { status: 403 });

    const res = NextResponse.redirect(new URL(transient.next || "/", base));
    res.cookies.set(SESSION_COOKIE, await signSession({ sub: claims.sub, email, name: (claims.name as string) ?? null }, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: base.startsWith("https"),
      path: "/",
      maxAge: sessionMaxAge,
    });
    res.cookies.set(OIDC_COOKIE, "", { path: "/auth", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[lasso] OIDC callback failed:", err);
    return new NextResponse("Sign-in failed. Check the server logs.", { status: 401 });
  }
}

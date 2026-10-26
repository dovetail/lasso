import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/auth/session";

const PUBLIC = ["/auth/", "/healthz", "/readyz", "/signed-out"];

export async function proxy(req: NextRequest) {
  if ((process.env.LASSO_AUTH_MODE ?? "oidc") === "none") return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.LASSO_SESSION_SECRET);
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const login = new URL("/auth/login", req.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

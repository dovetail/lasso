import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

export async function currentUser(): Promise<SessionUser | null> {
  const e = env();
  if (e.LASSO_AUTH_MODE === "none") return { sub: "local", email: null, name: "Local user" };
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, e.LASSO_SESSION_SECRET);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

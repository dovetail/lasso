import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "lasso_session";
export const OIDC_COOKIE = "lasso_oidc";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
}

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser, secret: string): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key(secret));
}

export async function verifySession(token: string | undefined, secret: string | undefined): Promise<SessionUser | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return { sub: String(payload.sub), email: (payload.email as string) ?? null, name: (payload.name as string) ?? null };
  } catch {
    return null;
  }
}

export async function signTransient(data: Record<string, string>, secret: string): Promise<string> {
  return new SignJWT(data).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key(secret));
}

export async function verifyTransient(token: string | undefined, secret: string): Promise<Record<string, string> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload as Record<string, string>;
  } catch {
    return null;
  }
}

export const sessionMaxAge = SESSION_TTL_SECONDS;

import * as client from "openid-client";
import { env } from "@/lib/env";

let cached: Promise<client.Configuration> | undefined;

export function oidcConfigured() {
  const e = env();
  return Boolean(e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET);
}

export function oidcConfig(): Promise<client.Configuration> {
  const e = env();
  const issuer = new URL(e.OIDC_ISSUER!);
  const local = issuer.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(issuer.hostname);
  cached ??= client.discovery(issuer, e.OIDC_CLIENT_ID!, e.OIDC_CLIENT_SECRET!, undefined, local ? { execute: [client.allowInsecureRequests] } : undefined).catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

export function baseUrl(req: Request): string {
  const configured = env().LASSO_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export function emailAllowed(email: string | null): boolean {
  const domains = env()
    .OIDC_ALLOWED_DOMAINS?.split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!domains?.length) return true;
  if (!email) return false;
  return domains.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

export { client };

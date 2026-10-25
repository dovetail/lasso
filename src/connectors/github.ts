import { createAppAuth } from "@octokit/auth-app";
import { HttpClient, HttpError } from "./http";

export interface GithubMember {
  login: string;
  name: string | null;
  publicEmail: string | null;
  verifiedEmails: string[];
  samlEmails: string[];
}

export interface GithubTeam {
  id: number;
  slug: string;
  name: string;
  parentSlug: string | null;
  members: string[];
}

export interface GithubSnapshot {
  org: string;
  members: GithubMember[];
  teams: GithubTeam[];
  warnings: string[];
}

export interface GithubAuth {
  token?: string;
  appId?: string;
  installationId?: string;
  privateKey?: string;
}

async function resolveToken(auth: GithubAuth, org: string, apiBase: string): Promise<string> {
  if (auth.token) return auth.token;
  if (!auth.appId || !auth.privateKey) throw new Error("GitHub auth requires GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY");
  const privateKey = auth.privateKey.includes("BEGIN") ? auth.privateKey.replace(/\\n/g, "\n") : Buffer.from(auth.privateKey, "base64").toString("utf8");
  const appAuth = createAppAuth({ appId: auth.appId, privateKey });
  let installationId = auth.installationId ? Number(auth.installationId) : undefined;
  if (!installationId) {
    const { token: jwt } = await appAuth({ type: "app" });
    const res = await fetch(`${apiBase}/orgs/${org}/installation`, {
      headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`Could not find GitHub App installation for ${org}: HTTP ${res.status}`);
    installationId = ((await res.json()) as { id: number }).id;
  }
  const { token } = await appAuth({ type: "installation", installationId });
  return token;
}

const MEMBERS_QUERY = `
query($org: String!, $after: String, $withVerified: Boolean!) {
  organization(login: $org) {
    membersWithRole(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        login
        name
        email
        organizationVerifiedDomainEmails(login: $org) @include(if: $withVerified)
      }
    }
  }
}`;

const SAML_QUERY = `
query($org: String!, $after: String) {
  organization(login: $org) {
    samlIdentityProvider {
      externalIdentities(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          user { login }
          samlIdentity { nameId emails { value } }
        }
      }
    }
  }
}`;

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class GithubClient {
  private http!: HttpClient;

  constructor(
    private readonly org: string,
    private readonly auth: GithubAuth,
    private readonly apiBase = "https://api.github.com",
  ) {}

  private async init() {
    if (this.http) return;
    const token = await resolveToken(this.auth, this.org, this.apiBase);
    this.http = new HttpClient(
      this.apiBase,
      { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      50,
    );
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<GqlResponse<T>> {
    return this.http.json<GqlResponse<T>>("/graphql", { method: "POST", body: { query, variables } });
  }

  private async restAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 200; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const items = await this.http.json<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  async snapshot(): Promise<GithubSnapshot> {
    await this.init();
    const warnings: string[] = [];
    const members = new Map<string, GithubMember>();

    let withVerified = true;
    let after: string | null = null;
    for (let i = 0; i < 500; i++) {
      type R = {
        organization: {
          membersWithRole: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{ login: string; name: string | null; email: string | null; organizationVerifiedDomainEmails?: string[] }>;
          };
        } | null;
      };
      const res: GqlResponse<R> = await this.gql<R>(MEMBERS_QUERY, { org: this.org, after, withVerified });
      if (res.errors?.length && withVerified) {
        warnings.push(`Verified-domain emails unavailable (${res.errors[0]!.message}); falling back to public emails.`);
        withVerified = false;
        after = null;
        members.clear();
        continue;
      }
      if (res.errors?.length || !res.data?.organization) {
        throw new Error(`GitHub members query failed: ${res.errors?.[0]?.message ?? "organization not found"}`);
      }
      const conn = res.data.organization.membersWithRole;
      for (const n of conn.nodes) {
        members.set(n.login.toLowerCase(), {
          login: n.login,
          name: n.name,
          publicEmail: n.email || null,
          verifiedEmails: (n.organizationVerifiedDomainEmails ?? []).map((e) => e.toLowerCase()),
          samlEmails: [],
        });
      }
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    try {
      let samlAfter: string | null = null;
      for (let i = 0; i < 500; i++) {
        type R = {
          organization: {
            samlIdentityProvider: {
              externalIdentities: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<{ user: { login: string } | null; samlIdentity: { nameId: string | null; emails: Array<{ value: string }> } | null }>;
              };
            } | null;
          } | null;
        };
        const res: GqlResponse<R> = await this.gql<R>(SAML_QUERY, { org: this.org, after: samlAfter });
        const idp = res.data?.organization?.samlIdentityProvider;
        if (res.errors?.length || !idp) {
          if (res.errors?.length) warnings.push(`SAML identities unavailable (${res.errors[0]!.message}).`);
          break;
        }
        for (const n of idp.externalIdentities.nodes) {
          const m = n.user ? members.get(n.user.login.toLowerCase()) : undefined;
          if (!m || !n.samlIdentity) continue;
          const emails = [n.samlIdentity.nameId, ...n.samlIdentity.emails.map((e) => e.value)]
            .filter((e): e is string => Boolean(e && e.includes("@")))
            .map((e) => e.toLowerCase());
          m.samlEmails.push(...emails);
        }
        if (!idp.externalIdentities.pageInfo.hasNextPage) break;
        samlAfter = idp.externalIdentities.pageInfo.endCursor;
      }
    } catch (err) {
      warnings.push(`SAML identities unavailable (${(err as Error).message}).`);
    }

    const teams: GithubTeam[] = [];
    const rawTeams = await this.restAll<{ id: number; slug: string; name: string; parent: { slug: string } | null }>(`/orgs/${this.org}/teams`);
    for (const t of rawTeams) {
      try {
        const m = await this.restAll<{ login: string }>(`/orgs/${this.org}/teams/${t.slug}/members`);
        teams.push({ id: t.id, slug: t.slug, name: t.name, parentSlug: t.parent?.slug ?? null, members: m.map((x) => x.login) });
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) continue;
        throw err;
      }
    }

    return { org: this.org, members: [...members.values()], teams, warnings };
  }
}

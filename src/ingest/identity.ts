import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { GithubSnapshot } from "@/connectors/github";
import type { DB } from "@/db/client";
import { githubTeams, identityOverrides, people, personEmails, platformAccounts, teamMemberships, type MatchSource } from "@/db/schema";
import { today } from "@/lib/dates";

const SOURCE_RANK: Record<string, number> = { github_saml: 3, github_verified: 2, github_public: 1 };

/** First-seen memberships are backdated so history is attributed to the team. */
const MEMBERSHIP_EPOCH = "2000-01-01";

export async function writeGithubSnapshot(db: DB, snap: GithubSnapshot): Promise<number> {
  let written = 0;
  const personIdByLogin = new Map<string, number>();

  for (const m of snap.members) {
    const login = m.login.toLowerCase();
    const primaryEmail = m.samlEmails[0] ?? m.verifiedEmails[0] ?? m.publicEmail?.toLowerCase() ?? null;
    const [row] = await db
      .insert(people)
      .values({ githubLogin: login, displayName: m.name ?? m.login, primaryEmail })
      .onConflictDoUpdate({
        target: people.githubLogin,
        set: {
          displayName: sql`coalesce(excluded.display_name, ${people.displayName})`,
          primaryEmail: sql`coalesce(excluded.primary_email, ${people.primaryEmail})`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: people.id });
    personIdByLogin.set(login, row!.id);
    written++;
  }

  const emailOwner = new Map<string, { personId: number; source: MatchSource }>();
  for (const m of snap.members) {
    const personId = personIdByLogin.get(m.login.toLowerCase())!;
    const candidates: Array<[string, MatchSource]> = [
      ...m.samlEmails.map((e) => [e, "github_saml"] as [string, MatchSource]),
      ...m.verifiedEmails.map((e) => [e, "github_verified"] as [string, MatchSource]),
      ...(m.publicEmail ? [[m.publicEmail.toLowerCase(), "github_public"] as [string, MatchSource]] : []),
    ];
    for (const [email, source] of candidates) {
      const existing = emailOwner.get(email);
      if (!existing || SOURCE_RANK[source]! > SOURCE_RANK[existing.source]!) emailOwner.set(email, { personId, source });
    }
  }
  await db.delete(personEmails).where(inArray(personEmails.source, ["github_saml", "github_verified", "github_public"]));
  if (emailOwner.size) {
    await db
      .insert(personEmails)
      .values([...emailOwner.entries()].map(([email, v]) => ({ email, personId: v.personId, source: v.source })))
      .onConflictDoNothing();
  }

  const day = today();
  for (const t of snap.teams) {
    const [team] = await db
      .insert(githubTeams)
      .values({ githubId: t.id, slug: t.slug, name: t.name, parentSlug: t.parentSlug })
      .onConflictDoUpdate({
        target: githubTeams.githubId,
        set: { slug: t.slug, name: t.name, parentSlug: t.parentSlug, updatedAt: sql`now()` },
      })
      .returning({ id: githubTeams.id });
    const teamId = team!.id;
    const hadAny = await db.query.teamMemberships.findFirst({ where: eq(teamMemberships.teamId, teamId) });
    const open = await db.query.teamMemberships.findMany({ where: and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.endedOn)) });
    const current = new Set(t.members.map((l) => personIdByLogin.get(l.toLowerCase())).filter((x): x is number => x != null));
    const openIds = new Set(open.map((o) => o.personId));

    const toAdd = [...current].filter((id) => !openIds.has(id));
    if (toAdd.length) {
      await db.insert(teamMemberships).values(toAdd.map((personId) => ({ personId, teamId, startedOn: hadAny ? day : MEMBERSHIP_EPOCH })));
    }
    const toEnd = open.filter((o) => !current.has(o.personId)).map((o) => o.id);
    if (toEnd.length) await db.update(teamMemberships).set({ endedOn: day }).where(inArray(teamMemberships.id, toEnd));
    written += toAdd.length + toEnd.length + 1;
  }

  const liveTeamIds = snap.teams.map((t) => t.id);
  const goneTeams = await db.query.githubTeams.findMany();
  const gone = goneTeams.filter((t) => !liveTeamIds.includes(t.githubId)).map((t) => t.id);
  if (gone.length) {
    await db
      .update(teamMemberships)
      .set({ endedOn: day })
      .where(and(inArray(teamMemberships.teamId, gone), isNull(teamMemberships.endedOn)));
  }

  return written;
}

function accountEmail(a: { email: string | null; externalId: string }) {
  if (a.email) return a.email.toLowerCase();
  if (a.externalId.startsWith("email:")) return a.externalId.slice(6);
  return null;
}

/**
 * Link every platform account to a person: manual override, then GitHub
 * emails, then an email-only person so cross-platform reporting still works
 * before (or without) GitHub.
 */
export async function resolveIdentities(db: DB): Promise<number> {
  const overrides = new Map((await db.select().from(identityOverrides)).map((o) => [o.email.toLowerCase(), o.githubLogin.toLowerCase()]));
  const emails = new Map((await db.select().from(personEmails)).map((e) => [e.email, e]));
  const allPeople = await db.select().from(people);
  const byLogin = new Map(allPeople.filter((p) => p.githubLogin).map((p) => [p.githubLogin!, p.id]));
  const emailOnly = new Map(allPeople.filter((p) => !p.githubLogin && p.primaryEmail).map((p) => [p.primaryEmail!.toLowerCase(), p.id]));

  const accounts = await db.select().from(platformAccounts);
  let changed = 0;

  for (const a of accounts) {
    const email = accountEmail(a);
    let personId: number | null = null;
    let source: MatchSource = "unmatched";

    if (email) {
      const login = overrides.get(email);
      const viaEmail = emails.get(email);
      if (login) {
        personId = byLogin.get(login) ?? null;
        if (personId == null) {
          const [p] = await db.insert(people).values({ githubLogin: login, displayName: login, primaryEmail: email }).returning({ id: people.id });
          personId = p!.id;
          byLogin.set(login, personId);
        }
        source = "manual";
      } else if (viaEmail) {
        personId = viaEmail.personId;
        source = viaEmail.source;
      } else {
        personId = emailOnly.get(email) ?? null;
        if (personId == null) {
          const [p] = await db.insert(people).values({ displayName: a.name ?? email, primaryEmail: email }).returning({ id: people.id });
          personId = p!.id;
          emailOnly.set(email, personId);
        }
      }
    }

    if (a.personId !== personId || a.matchSource !== source) {
      await db.update(platformAccounts).set({ personId, matchSource: source, updatedAt: new Date() }).where(eq(platformAccounts.id, a.id));
      changed++;
    }
  }

  await db
    .delete(people)
    .where(
      and(
        isNull(people.githubLogin),
        notExists(db.select({ one: sql`1` }).from(platformAccounts).where(eq(platformAccounts.personId, people.id))),
      ),
    );

  return changed;
}

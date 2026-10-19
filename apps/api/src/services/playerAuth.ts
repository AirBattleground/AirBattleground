/**
 * Phase 5: sign-in with Google (ID token) or the dev-only email login. Phase 5b: everyone signs in this way and the
 * role comes from the email (packages/shared/src/access.ts):
 *   ADMIN_EMAIL → the ADMIN account · PENDING manager invitation or an existing manager → MANAGER · anyone else → PLAYER.
 * `signIn` is shared by /api/auth/google and /api/auth/dev-login so dev-login (tests) covers the same rules.
 */
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../db.js";
import { env, isProd } from "../env.js";
import { logger } from "../logger.js";
import { AppError } from "../lib/errors.js";
import { userWithTeamInclude, type UserWithTeam } from "../lib/serialize.js";

export const devLoginEnabled = () => env.PLAYER_DEV_LOGIN && !isProd;

export interface PlayerIdentity {
  email: string;
  name: string | null;
  googleSub: string | null;
  avatarUrl: string | null;
}

let client: OAuth2Client | null = null;

/** Verifies a Google Identity Services credential (ID token): audience = GOOGLE_CLIENT_ID, email verified. */
export async function verifyGoogleCredential(credential: string): Promise<PlayerIdentity> {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError("FORBIDDEN", "Google sign-in isn't set up yet. Contact the admin.");
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new AppError("UNAUTHENTICATED", "Google sign-in didn't work. Please try again.");
  }
  if (!payload?.sub || !payload.email) throw new AppError("UNAUTHENTICATED", "Google sign-in didn't work. Please try again.");
  if (payload.email_verified !== true) throw new AppError("FORBIDDEN", "Your Google email isn't verified yet. Verify it with Google and try again.");
  return { email: payload.email.toLowerCase(), name: payload.name ?? null, googleSub: payload.sub, avatarUrl: payload.picture ?? null };
}

const DISABLED = "This account is disabled. Contact the admin.";
export const NOT_ADMIN = "This Google account isn't the admin account.";

const insensitive = (email: string) => ({ equals: email, mode: "insensitive" as const });

export const isAdminEmail = (email: string) => email.trim().toLowerCase() === env.ADMIN_EMAIL;

/**
 * Resolves the signed-in Google identity to an account and records the sign-in. Role by email:
 * ADMIN_EMAIL → the admin; PENDING invite or existing manager → MANAGER; anyone else → PLAYER (created on first sign-in).
 */
export async function signIn(id: PlayerIdentity): Promise<UserWithTeam> {
  const email = id.email.trim().toLowerCase();
  if (isAdminEmail(email)) return signInAdminAccount({ ...id, email });

  const user =
    (id.googleSub ? await prisma.user.findUnique({ where: { googleSub: id.googleSub }, include: userWithTeamInclude }) : null) ??
    (await prisma.user.findFirst({ where: { email: insensitive(email) }, include: userWithTeamInclude }));
  if (user?.role === "ADMIN") throw new AppError("FORBIDDEN", NOT_ADMIN);
  if (user && !user.isActive) throw new AppError("FORBIDDEN", DISABLED);

  const invite = await prisma.managerInvite.findFirst({ where: { email, status: "PENDING" } });
  const now = new Date();
  const googleData = (u: { googleSub: string | null } | null) => ({
    lastLoginAt: now,
    ...(id.googleSub && !u?.googleSub ? { googleSub: id.googleSub } : {}),
    ...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
  });

  if (user?.role === "MANAGER") {
    return prisma.$transaction(async (tx) => {
      if (invite) {
        // invited after the account existed (e.g. an old username/password manager): just close the invite
        await tx.managerInvite.updateMany({
          where: { id: invite.id, status: "PENDING" },
          data: { status: "ACCEPTED", acceptedUserId: user.id, acceptedAt: now },
        });
      }
      return tx.user.update({
        where: { id: user.id },
        data: { ...googleData(user), ...(invite && !user.orgName ? { orgName: invite.orgName } : {}) },
        include: userWithTeamInclude,
      });
    });
  }

  if (invite) {
    if (user && user.membership) {
      // the invite was created before they joined a team: stay a player until they leave it
      logger.warn({ userId: user.id, inviteId: invite.id }, "invited manager is in a team; signed in as player");
    } else {
      try {
        return await acceptInvite(invite, user, { ...id, email }, now);
      } catch (e) {
        if (!(e instanceof InviteRace)) throw e;
        // the invite was revoked / the player joined a team at the same moment: fall through to a normal sign-in
        if (!user) return signIn(id);
      }
    }
  }

  if (user) {
    return prisma.user.update({ where: { id: user.id }, data: googleData(user), include: userWithTeamInclude });
  }
  const displayName = (id.name?.trim() || email.split("@")[0] || "Player").slice(0, 60);
  try {
    return await prisma.user.create({
      data: { role: "PLAYER", email, googleSub: id.googleSub, displayName, avatarUrl: id.avatarUrl, lastLoginAt: now },
      include: userWithTeamInclude,
    });
  } catch {
    // two first sign-ins racing: the other one created the account
    const again = await prisma.user.findUnique({ where: { email }, include: userWithTeamInclude });
    if (again?.role === "PLAYER" && again.isActive) return again;
    throw new AppError("INTERNAL", "Something went wrong. Please try again.");
  }
}

class InviteRace extends Error {}

/** Creates the MANAGER from a PENDING invite, or converts the player `existing` (not in a team); marks the invite ACCEPTED. */
async function acceptInvite(
  invite: { id: string; name: string; orgName: string },
  existing: UserWithTeam | null,
  id: PlayerIdentity,
  now: Date,
): Promise<UserWithTeam> {
  return prisma.$transaction(async (tx) => {
    let userId: string;
    const profile = {
      role: "MANAGER" as const,
      displayName: invite.name,
      orgName: invite.orgName,
      lastLoginAt: now,
      ...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
    };
    if (existing) {
      if (await tx.teamMember.findUnique({ where: { userId: existing.id }, select: { id: true } })) throw new InviteRace();
      // leftovers of their player life that a manager can't act on
      await tx.teamJoinRequest.deleteMany({ where: { userId: existing.id, status: "PENDING" } });
      await tx.teamSuggestion.deleteMany({ where: { fromUserId: existing.id, status: "OPEN" } });
      await tx.user.update({
        where: { id: existing.id },
        data: { ...profile, ...(id.googleSub && !existing.googleSub ? { googleSub: id.googleSub } : {}) },
      });
      userId = existing.id;
      logger.info({ userId, inviteId: invite.id }, "player converted to manager by invitation");
    } else {
      const created = await tx.user.create({ data: { ...profile, email: id.email, googleSub: id.googleSub } });
      userId = created.id;
    }
    const done = await tx.managerInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedUserId: userId, acceptedAt: now },
    });
    if (done.count !== 1) throw new InviteRace();
    return tx.user.findUniqueOrThrow({ where: { id: userId }, include: userWithTeamInclude });
  });
}

/** For the admin console's own Google sign-in: only ADMIN_EMAIL gets in (nobody else is created or changed). */
export async function signInAdmin(id: PlayerIdentity): Promise<UserWithTeam> {
  if (!isAdminEmail(id.email)) throw new AppError("FORBIDDEN", NOT_ADMIN);
  return signInAdminAccount({ ...id, email: id.email.trim().toLowerCase() });
}

/**
 * ADMIN_EMAIL signed in: use the one ADMIN account (the one already holding that email, else the seeded
 * ADMIN_USERNAME, else the oldest admin) and attach the email + Google account to it. If a PLAYER already holds that
 * email / Google account (someone signed in as a player before ADMIN_EMAIL was set up), that player account is
 * detached (email + googleSub cleared) and disabled, so there is still exactly one admin. A MANAGER holding it is
 * refused (409) — that needs a human decision.
 */
async function signInAdminAccount(id: PlayerIdentity): Promise<UserWithTeam> {
  const email = id.email;
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  const admin =
    admins.find((a) => a.email?.toLowerCase() === email) ?? admins.find((a) => a.username === env.ADMIN_USERNAME) ?? admins[0];
  if (!admin) {
    logger.error({ email }, "admin Google sign-in but no ADMIN account exists (run the seed)");
    throw new AppError("FORBIDDEN", "The admin account isn't set up yet. Run the seed first.");
  }
  if (!admin.isActive) throw new AppError("FORBIDDEN", DISABLED);

  const others = await prisma.user.findMany({
    where: {
      id: { not: admin.id },
      OR: [{ email: insensitive(email) }, ...(id.googleSub ? [{ googleSub: id.googleSub }] : [])],
    },
    select: { id: true, role: true },
  });
  const blocking = others.find((o) => o.role !== "PLAYER");
  if (blocking) {
    logger.error({ email, userId: blocking.id, role: blocking.role }, "ADMIN_EMAIL belongs to another organiser account");
    throw new AppError("CONFLICT", "This email is used by another organiser account. Change that account's email first.");
  }
  return prisma.$transaction(async (tx) => {
    for (const o of others) {
      logger.warn({ email, userId: o.id }, "ADMIN_EMAIL was held by a player account: detaching and disabling it");
      await tx.user.update({ where: { id: o.id }, data: { email: null, googleSub: null, isActive: false } });
    }
    return tx.user.update({
      where: { id: admin.id },
      data: {
        email,
        lastLoginAt: new Date(),
        ...(id.googleSub ? { googleSub: id.googleSub } : {}),
        ...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
      },
      include: userWithTeamInclude,
    });
  });
}

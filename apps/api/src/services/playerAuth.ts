/** Phase 5: player sign-in (Google ID token, or dev-only email login). Creates the PLAYER on first sign-in. */
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../db.js";
import { env, isProd } from "../env.js";
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

/** Find the player by Google sub, then by email; create one on first sign-in. Refuses disabled and non-player accounts. */
export async function signInPlayer(id: PlayerIdentity): Promise<UserWithTeam> {
  const email = id.email.toLowerCase();
  let user =
    (id.googleSub ? await prisma.user.findUnique({ where: { googleSub: id.googleSub }, include: userWithTeamInclude }) : null) ??
    (await prisma.user.findUnique({ where: { email }, include: userWithTeamInclude }));
  if (user && user.role !== "PLAYER") {
    throw new AppError("FORBIDDEN", "This email belongs to an organiser account. Sign in with your username instead.");
  }
  if (user && !user.isActive) throw new AppError("FORBIDDEN", "This account is disabled. Contact the admin.");
  const now = new Date();
  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        ...(id.googleSub && !user.googleSub ? { googleSub: id.googleSub } : {}),
        ...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
      },
      include: userWithTeamInclude,
    });
    return user;
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

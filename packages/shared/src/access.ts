/**
 * Phase 5b — one sign-in for everyone: "Continue with Google". The role comes from the email:
 *   - ADMIN_EMAIL (API env, default airbattleground@gmail.com)          → ADMIN   → admin console (/admin-ui)
 *   - an email with a PENDING manager invitation (or an existing manager) → MANAGER → /manager
 *   - anyone else                                                        → PLAYER  → /team (or /welcome)
 * Username/password endpoints stay in the API (Android manager app, emergency access) but no UI shows them.
 *
 * AUTH
 *   POST   /api/auth/google        GoogleLoginInput  → AuthResponse  any role. When the user is ADMIN the admin
 *                                                      session cookie (sx_admin) is set as well; the web then
 *                                                      opens /admin-ui/.
 *   POST   /api/admin/auth/google  GoogleLoginInput  → AuthResponse  ADMIN only (403 FORBIDDEN "This Google account
 *                                                      isn't the admin account.") — used by the admin console's
 *                                                      own login page.
 *   (dev-login follows the same email → role rules; dev only)
 *
 * ADMIN — manager invitations
 *   GET    /api/admin/manager-invites?status=PENDING|ACCEPTED|REVOKED → ListResponse<ManagerInviteRow> (default PENDING; newest first)
 *   POST   /api/admin/manager-invites     CreateManagerInviteInput   → ManagerInviteRow (201)
 *            409 CONFLICT fields.email: already a manager / the admin / already invited (pending) /
 *            a player who is in a team ("They're a player in a team — they must leave it first.")
 *   DELETE /api/admin/manager-invites/:id                             → 204 revoke (PENDING only)
 * Accepting: the invited email signs in with Google → becomes MANAGER (displayName = name, orgName), invite ACCEPTED.
 * A PLAYER account with that email and no team is converted to MANAGER on that sign-in.
 */
import { z } from "zod";

export const MANAGER_INVITE_STATUSES = ["PENDING", "ACCEPTED", "REVOKED"] as const;
export type ManagerInviteStatus = (typeof MANAGER_INVITE_STATUSES)[number];

export const createManagerInviteSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60, "At most 60 characters"),
  orgName: z.string().trim().min(2, "At least 2 characters").max(60, "At most 60 characters"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});
export type CreateManagerInviteInput = z.infer<typeof createManagerInviteSchema>;

export const managerInviteQuerySchema = z.object({ status: z.enum(MANAGER_INVITE_STATUSES).default("PENDING") });

export interface ManagerInviteRow {
  id: string;
  name: string;
  orgName: string;
  email: string;
  status: ManagerInviteStatus;
  invitedBy: { id: string; displayName: string } | null;
  /** set once accepted */
  manager: { id: string; displayName: string } | null;
  createdAt: string;
  acceptedAt: string | null;
}

/** Text for the "Send email" / WhatsApp buttons on an invite (origin = the web app's origin). */
export function managerInviteMessage(invite: Pick<ManagerInviteRow, "name" | "orgName" | "email">, origin: string) {
  const subject = `You're invited to run ${invite.orgName} on AirBattleground`;
  const body =
    `Hi ${invite.name},\n\n` +
    `You've been invited as an organiser for ${invite.orgName} on AirBattleground.\n\n` +
    `Open ${origin}/login and tap "Continue with Google" using ${invite.email}. ` +
    `You'll land on your organiser dashboard, ready to create scrims and tournaments.\n`;
  return { subject, body };
}

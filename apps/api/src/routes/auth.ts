import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ADMIN_COOKIE, APP_COOKIE, loginSchema, type AuthResponse, type Role } from "@7xen/shared";
import { prisma } from "../db.js";
import { isTest } from "../env.js";
import { clearSessionCookie, setSessionCookie } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { toSessionUser, userWithTeamInclude } from "../lib/serialize.js";
import { parse } from "../lib/validate.js";
import { latestRequestForLogin } from "../services/teamRequests.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";

const WRONG_CREDS = "Wrong username or password";

function loginLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: isTest ? 10_000 : 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many login attempts. Wait a minute and try again." },
      });
    },
  });
}

/** Builds login/logout/me for one session cookie and the roles allowed on it. */
function authRouter(cookieName: string, roles: Role[]) {
  const r = Router();

  r.post("/login", loginLimiter(), async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { username }, include: userWithTeamInclude });
    if (!user && roles.includes("TEAM")) {
      // a manager registered this team but the admin hasn't approved it (or rejected it)
      const pending = await latestRequestForLogin(username);
      if (pending && (await verifyPassword(password, pending.passwordHash))) {
        throw new AppError(
          "FORBIDDEN",
          pending.status === "PENDING"
            ? "Your team is waiting for admin approval. You can log in once it's approved."
            : `Your team registration was not approved${pending.rejectionReason ? `: ${pending.rejectionReason}` : ""}. Contact your manager.`,
        );
      }
    }
    if (!user || !roles.includes(user.role) || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError("UNAUTHENTICATED", WRONG_CREDS);
    }
    if (!user.isActive) throw new AppError("FORBIDDEN", "This account is disabled. Contact the admin.");
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSessionCookie(res, cookieName, { sub: user.id, role: user.role });
    const body: AuthResponse = { user: toSessionUser(user) };
    res.json(body);
  });

  r.post("/logout", (_req, res) => {
    clearSessionCookie(res, cookieName);
    res.status(204).end();
  });

  r.get("/me", requireAuth(roles, cookieName), (req, res) => {
    const body: AuthResponse = { user: toSessionUser(currentUser(req)) };
    res.json(body);
  });

  return r;
}

export const appAuthRouter = () => authRouter(APP_COOKIE, ["MANAGER", "TEAM"]);
export const adminAuthRouter = () => authRouter(ADMIN_COOKIE, ["ADMIN"]);

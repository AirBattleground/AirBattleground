import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  ADMIN_COOKIE,
  APP_COOKIE,
  devLoginSchema,
  googleLoginSchema,
  loginSchema,
  mobileLoginSchema,
  type AuthConfig,
  type AuthResponse,
  type MobileTokenResponse,
  type Role,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { env, isTest } from "../env.js";
import { clearSessionCookie, setSessionCookie, signMobileToken } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { toSessionUser, userWithTeamInclude } from "../lib/serialize.js";
import { parse } from "../lib/validate.js";
import { devLoginEnabled, signInPlayer, verifyGoogleCredential } from "../services/playerAuth.js";
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

/** Checks credentials for a login allowed on `roles`; same rules (and messages) for the web and the app. */
async function checkLogin(username: string, password: string, roles: Role[]) {
  const user = await prisma.user.findUnique({ where: { username }, include: userWithTeamInclude });
  // players have no password (phase 5): they sign in with Google
  if (user?.role === "PLAYER") throw new AppError("FORBIDDEN", "Players sign in with Google. Tap “Continue with Google”.");
  if (!user || !user.passwordHash || !roles.includes(user.role) || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("UNAUTHENTICATED", WRONG_CREDS);
  }
  if (!user.isActive) throw new AppError("FORBIDDEN", "This account is disabled. Contact the admin.");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

/** Builds login/logout/me for one session cookie and the roles allowed on it. */
function authRouter(cookieName: string, roles: Role[]) {
  const r = Router();
  /** username/password logins (players sign in with Google instead) */
  const passwordRoles = roles.filter((x) => x !== "PLAYER");

  r.post("/login", loginLimiter(), async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = await checkLogin(username, password, passwordRoles);
    setSessionCookie(res, cookieName, { sub: user.id, role: user.role });
    const body: AuthResponse = { user: toSessionUser(user) };
    res.json(body);
  });

  // phase 4: bearer token for the 7XEN Manager app (managers only)
  if (roles.includes("MANAGER")) {
    r.post("/token", loginLimiter(), async (req, res) => {
      const { username, password } = parse(mobileLoginSchema, req.body);
      const user = await checkLogin(username, password, passwordRoles);
      if (user.role !== "MANAGER") throw new AppError("FORBIDDEN", "The 7XEN Manager app is for manager accounts only");
      const { token, expiresAt } = signMobileToken({ sub: user.id, role: user.role });
      const body: MobileTokenResponse = { token, expiresAt: expiresAt.toISOString(), user: toSessionUser(user) };
      res.setHeader("Cache-Control", "no-store");
      res.json(body);
    });
  }

  // ---- phase 5: players (Google sign-in; dev-only email login) ----
  if (roles.includes("PLAYER")) {
    r.get("/config", (_req, res) => {
      const body: AuthConfig = { googleClientId: env.GOOGLE_CLIENT_ID, devLogin: devLoginEnabled() };
      res.json(body);
    });
    r.post("/google", loginLimiter(), async (req, res) => {
      const { credential } = parse(googleLoginSchema, req.body);
      const user = await signInPlayer(await verifyGoogleCredential(credential));
      setSessionCookie(res, cookieName, { sub: user.id, role: user.role });
      const body: AuthResponse = { user: toSessionUser(user) };
      res.json(body);
    });
    r.post("/dev-login", loginLimiter(), async (req, res) => {
      if (!devLoginEnabled()) throw new AppError("NOT_FOUND", "Not found");
      const { email, name } = parse(devLoginSchema, req.body);
      const user = await signInPlayer({ email, name: name || null, googleSub: null, avatarUrl: null });
      setSessionCookie(res, cookieName, { sub: user.id, role: user.role });
      const body: AuthResponse = { user: toSessionUser(user) };
      res.json(body);
    });
  }

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

export const appAuthRouter = () => authRouter(APP_COOKIE, ["MANAGER", "PLAYER"]);
export const adminAuthRouter = () => authRouter(ADMIN_COOKIE, ["ADMIN"]);

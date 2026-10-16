import type { NextFunction, Request, Response } from "express";
import type { Role } from "@7xen/shared";
import { prisma } from "../db.js";
import { clearSessionCookie, verifyToken } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { userWithTeamInclude, type UserWithTeam } from "../lib/serialize.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserWithTeam;
    }
  }
}

/**
 * Loads the session user from `cookieName` and enforces one of `roles`.
 * The user is re-read on every request so disabled accounts are kicked out immediately.
 */
export function requireAuth(roles: Role | Role[], cookieName: string) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[cookieName] as string | undefined;
    if (!token) throw new AppError("UNAUTHENTICATED", "Please log in to continue");
    const payload = verifyToken(token);
    if (!payload) {
      clearSessionCookie(res, cookieName);
      throw new AppError("UNAUTHENTICATED", "Your session has ended. Please log in again.");
    }
    // valid session, wrong area: refuse but keep the user signed in
    if (!allowed.includes(payload.role)) throw new AppError("FORBIDDEN", "You don't have access to this page");
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: userWithTeamInclude });
    if (!user || !user.isActive || user.role !== payload.role) {
      clearSessionCookie(res, cookieName);
      throw new AppError("UNAUTHENTICATED", "Your session has ended. Please log in again.");
    }
    req.user = user;
    next();
  };
}

/** The authenticated user (only call after requireAuth). */
export function currentUser(req: Request): UserWithTeam {
  if (!req.user) throw new AppError("UNAUTHENTICATED", "Please log in to continue");
  return req.user;
}

import type { NextFunction, Request, Response } from "express";
import type { Role } from "@7xen/shared";
import { prisma } from "../db.js";
import { bearerToken, clearSessionCookie, verifyToken } from "../lib/auth.js";
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
 * Loads the session user from `Authorization: Bearer <token>` (manager app) or the `cookieName` session
 * cookie (web), and enforces one of `roles`. A bearer token wins when both are sent; a bad bearer token
 * never clears the cookie. The user is re-read on every request so disabled accounts are kicked out immediately.
 */
export function requireAuth(roles: Role | Role[], cookieName: string) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = bearerToken(req.headers.authorization);
    const token = bearer ?? (req.cookies?.[cookieName] as string | undefined);
    if (!token) throw new AppError("UNAUTHENTICATED", "Please log in to continue");
    const endSession = () => {
      if (!bearer) clearSessionCookie(res, cookieName);
    };
    const payload = verifyToken(token);
    if (!payload) {
      endSession();
      throw new AppError("UNAUTHENTICATED", "Your session has ended. Please log in again.");
    }
    // valid session, wrong area: refuse but keep the user signed in
    if (!allowed.includes(payload.role)) throw new AppError("FORBIDDEN", "You don't have access to this page");
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: userWithTeamInclude });
    if (!user || !user.isActive || user.role !== payload.role) {
      endSession();
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

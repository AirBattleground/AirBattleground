import { useBox } from "@/features/studio/box";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role, SessionUser } from "@7xen/shared";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { homeFor, useAuth } from "./auth";
import { wasExplicitLogout } from "./session";

/** `?next=` targets we honour: only in-app paths the user's role can open (no open redirects). */
export function safeNext(user: SessionUser, next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return null;
  if (user.role === "MANAGER") return next === "/manager" || next.startsWith("/manager/") ? next : null;
  if (user.role === "PLAYER") {
    if (next === "/team" || next.startsWith("/team/") || next.startsWith("/join/")) return next;
  }
  return null;
}

/** Where a freshly signed-in user goes: onboarding first (keeping `next`), else `next`, else home. */
export function destinationFor(user: SessionUser, next: unknown) {
  const target = safeNext(user, next);
  if (user.role === "PLAYER" && user.player?.needsOnboarding) return target ? `/welcome?next=${encodeURIComponent(target)}` : "/welcome";
  return target ?? homeFor(user);
}

export const loginWithNext = (path: string) => `/login?next=${encodeURIComponent(path)}`;

/** Only render children for a signed-in user with `role`; otherwise redirect. Players finish onboarding first. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  if (isLoading) return <FullPageLoader />;
  // signed out on purpose → plain /login (no ?next=, so the next person isn't sent back to this area)
  if (!user) return <Navigate to={wasExplicitLogout() ? "/login" : loginWithNext(here)} replace state={{ from: loc.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  if (user.role === "PLAYER" && user.player?.needsOnboarding) return <Navigate to={`/welcome?next=${encodeURIComponent(here)}`} replace />;
  return <>{children}</>;
}

export function RedirectHome() {
  const { user, isLoading } = useAuth();
  // on a Studio Box the site is there for the Studio: the box signs in with its key as its manager
  const box = useBox();
  if (isLoading || !box.ready) return <FullPageLoader />;
  if (box.isBox && user?.role === "MANAGER") return <Navigate to="/manager/studio" replace />;
  return <Navigate to={homeFor(user)} replace />;
}

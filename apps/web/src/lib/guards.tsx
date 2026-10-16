import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role } from "@7xen/shared";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { homeFor, useAuth } from "./auth";

/** Only render children for a signed-in user with `role`; otherwise redirect. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const loc = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

export function RedirectHome() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader />;
  return <Navigate to={homeFor(user)} replace />;
}

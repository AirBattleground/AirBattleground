import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { useAuth } from "./auth";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const loc = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (!user || user.role !== "ADMIN") return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

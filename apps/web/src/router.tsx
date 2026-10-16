import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { RedirectHome, RequireRole } from "@/lib/guards";

// Route map is fixed (owned by the base). Each page file default-exports its component.
const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<FullPageLoader />}>
      <C />
    </Suspense>
  );
};

const LoginPage = () => page(() => import("@/pages/auth/LoginPage"));
const NotFoundPage = () => page(() => import("@/pages/NotFoundPage"));
const ManagerLayout = lazy(() => import("@/layouts/ManagerLayout"));
const TeamLayout = lazy(() => import("@/layouts/TeamLayout"));

export const router = createBrowserRouter([
  { path: "/", element: <RedirectHome /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/manager",
    element: (
      <RequireRole role="MANAGER">
        <Suspense fallback={<FullPageLoader />}>
          <ManagerLayout />
        </Suspense>
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import("@/pages/manager/DashboardPage")) },
      { path: "requests", element: page(() => import("@/pages/manager/RequestsPage")) },
      { path: "scrims", element: page(() => import("@/pages/manager/ScrimsPage")) },
      { path: "scrims/new", element: page(() => import("@/pages/manager/ScrimFormPage")) },
      { path: "scrims/:scrimId", element: page(() => import("@/pages/manager/ScrimDetailPage")) },
      { path: "scrims/:scrimId/edit", element: page(() => import("@/pages/manager/ScrimFormPage")) },
    ],
  },
  {
    path: "/team",
    element: (
      <RequireRole role="TEAM">
        <Suspense fallback={<FullPageLoader />}>
          <TeamLayout />
        </Suspense>
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import("@/pages/team/DashboardPage")) },
      { path: "scrims", element: page(() => import("@/pages/team/BrowseScrimsPage")) },
      { path: "registrations", element: page(() => import("@/pages/team/MyRegistrationsPage")) },
      { path: "profile", element: page(() => import("@/pages/team/ProfilePage")) },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);


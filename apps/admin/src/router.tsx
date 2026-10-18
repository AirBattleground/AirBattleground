import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { RequireAdmin } from "@/lib/guards";

const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<FullPageLoader />}>
      <C />
    </Suspense>
  );
};
const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));

export const router = createBrowserRouter([
  { path: "/login", element: page(() => import("@/pages/LoginPage")) },
  {
    path: "/",
    element: (
      <RequireAdmin>
        <Suspense fallback={<FullPageLoader />}>
          <AdminLayout />
        </Suspense>
      </RequireAdmin>
    ),
    children: [
      { index: true, element: page(() => import("@/pages/DashboardPage")) },
      { path: "managers", element: page(() => import("@/pages/ManagersPage")) },
      { path: "teams", element: page(() => import("@/pages/TeamsPage")) },
      { path: "tournaments", element: page(() => import("@/pages/tournaments/TournamentsPage")) },
      { path: "tournaments/:id", element: page(() => import("@/pages/tournaments/TournamentDetailPage")) },
      { path: "team-requests", element: page(() => import("@/pages/TeamRequestsPage")) },
      { path: "training", element: <Navigate to="/training/samples" replace /> },
      { path: "training/samples", element: page(() => import("@/pages/training/SamplesPage")) },
      { path: "training/samples/:id", element: page(() => import("@/pages/training/SampleEditorPage")) },
      { path: "manager-app", element: <Navigate to="/manager-app/recordings" replace /> },
      { path: "manager-app/recordings", element: page(() => import("@/pages/managerApp/RecordingsPage")) },
      { path: "manager-app/recipes", element: page(() => import("@/pages/managerApp/RecipesPage")) },
      { path: "manager-app/settings", element: page(() => import("@/pages/managerApp/SettingsPage")) },
    ],
  },
  { path: "*", element: page(() => import("@/pages/NotFoundPage")) },
], { basename: "/admin-ui" });

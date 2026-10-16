import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
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

/** Breadcrumb targets that aren't pages of their own (e.g. /manager/scrims/:id/:date) → the right page. */
function SessionRedirect({ area }: { area: "manager" | "team" }) {
  const { scrimId = "", date = "" } = useParams();
  return (
    <Navigate
      replace
      to={area === "manager" ? `/manager/scrims/${scrimId}?date=${date}&tab=matches` : `/team/results/${scrimId}/${date}`}
    />
  );
}

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
      { path: "scrims/:scrimId/:date", element: <SessionRedirect area="manager" /> },
      { path: "scrims/:scrimId/:date/matches", element: <SessionRedirect area="manager" /> },
      { path: "scrims/:scrimId/:date/matches/:matchId", element: page(() => import("@/pages/manager/MatchCenterPage")) },
      { path: "scrims/:scrimId/:date/standings", element: page(() => import("@/pages/manager/StandingsPage")) },
      { path: "teams", element: page(() => import("@/pages/manager/TeamsPage")) },
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
      { path: "results", element: page(() => import("@/pages/team/ResultsPage")) },
      { path: "results/:scrimId", element: <Navigate replace to="/team/results" /> },
      { path: "results/:scrimId/:date", element: page(() => import("@/pages/team/SessionResultsPage")) },
      { path: "results/:scrimId/:date/matches", element: <SessionRedirect area="team" /> },
      { path: "results/:scrimId/:date/matches/:matchId", element: page(() => import("@/pages/team/MatchScorecardPage")) },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);


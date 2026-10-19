import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate, useParams, type RouteObject } from "react-router-dom";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { RedirectHome, RequireRole } from "@/lib/guards";
import { RouteError } from "@/lib/chunkReload";
import { SplashReady } from "@/lib/splash";
import LoginPageComponent from "@/pages/auth/LoginPage";

// Route map is fixed (owned by the base). Each page file default-exports its component.
const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<FullPageLoader />}>
      <C />
      <SplashReady />
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

/** Breadcrumb targets under a tournament that aren't pages (…/stages, …/stages/:id/matches) → the nearest real page. */
function TournamentRedirect() {
  const { tournamentId = "", stageId } = useParams();
  return <Navigate replace to={stageId ? `/manager/tournaments/${tournamentId}/stages/${stageId}` : `/manager/tournaments/${tournamentId}?tab=stages`} />;
}

/** Team side: breadcrumb targets under a tournament that aren't pages (…/stages, …/matches) → the tournament hub. */
function TeamTournamentRedirect() {
  const { id = "" } = useParams();
  return <Navigate replace to={`/team/tournaments/${id}`} />;
}

// the login page is what visitors land on: part of the main bundle (no extra round trip), lazy() is created once
const LoginPage = LoginPageComponent;
const notFound = page(() => import("@/pages/NotFoundPage"));
const NotFoundPage = () => notFound;
const ManagerLayout = lazy(() => import("@/layouts/ManagerLayout"));
const TeamLayout = lazy(() => import("@/layouts/TeamLayout"));

const routes: RouteObject[] = [
  { path: "/", element: <RedirectHome /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/welcome", element: page(() => import("@/pages/player/WelcomePage")) },
  { path: "/join/:code", element: page(() => import("@/pages/player/JoinPage")) },
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
      { path: "app", element: page(() => import("@/pages/manager/AppPage")) },
      { path: "devices", element: page(() => import("@/pages/manager/DevicesPage")) },
      { path: "devices/:deviceId", element: page(() => import("@/pages/manager/DeviceLivePage")) },
      { path: "broadcast-layout", element: page(() => import("@/pages/manager/BroadcastLayoutPage")) },
      { path: "live", element: page(() => import("@/pages/live/LiveNowPage")) },
      { path: "live/:matchId", element: page(() => import("@/pages/team/LiveViewerPage")) },
      { path: "scrims", element: page(() => import("@/pages/manager/ScrimsPage")) },
      { path: "scrims/new", element: page(() => import("@/pages/manager/ScrimFormPage")) },
      { path: "scrims/:scrimId", element: page(() => import("@/pages/manager/ScrimDetailPage")) },
      { path: "scrims/:scrimId/edit", element: page(() => import("@/pages/manager/ScrimFormPage")) },
      { path: "scrims/:scrimId/:date", element: <SessionRedirect area="manager" /> },
      { path: "scrims/:scrimId/:date/matches", element: <SessionRedirect area="manager" /> },
      { path: "scrims/:scrimId/:date/matches/:matchId", element: page(() => import("@/pages/manager/MatchCenterPage")) },
      { path: "scrims/:scrimId/:date/standings", element: page(() => import("@/pages/manager/StandingsPage")) },
      { path: "tournaments", element: page(() => import("@/pages/manager/tournaments/TournamentsPage")) },
      { path: "tournaments/new", element: page(() => import("@/pages/manager/tournaments/TournamentWizardPage")) },
      { path: "tournaments/:tournamentId", element: page(() => import("@/pages/manager/tournaments/TournamentDetailPage")) },
      { path: "tournaments/:tournamentId/edit", element: page(() => import("@/pages/manager/tournaments/TournamentWizardPage")) },
      { path: "tournaments/:tournamentId/stages", element: <TournamentRedirect /> },
      { path: "tournaments/:tournamentId/stages/:stageId", element: page(() => import("@/pages/manager/tournaments/StagePage")) },
      { path: "tournaments/:tournamentId/stages/:stageId/matches", element: <TournamentRedirect /> },
      { path: "tournaments/:tournamentId/stages/:stageId/matches/:matchId", element: page(() => import("@/pages/manager/tournaments/TournamentMatchPage")) },
    ],
  },
  {
    path: "/team",
    element: (
      <RequireRole role="PLAYER">
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
      { path: "my-team", element: page(() => import("@/pages/team/MyTeamPage")) },
      { path: "results", element: page(() => import("@/pages/team/ResultsPage")) },
      { path: "results/:scrimId", element: <Navigate replace to="/team/results" /> },
      { path: "results/:scrimId/:date", element: page(() => import("@/pages/team/SessionResultsPage")) },
      { path: "results/:scrimId/:date/matches", element: <SessionRedirect area="team" /> },
      { path: "results/:scrimId/:date/matches/:matchId", element: page(() => import("@/pages/team/MatchScorecardPage")) },
      { path: "tournaments", element: page(() => import("@/pages/team/tournaments/TournamentsPage")) },
      { path: "tournaments/:id", element: page(() => import("@/pages/team/tournaments/TournamentHubPage")) },
      { path: "tournaments/:id/stages", element: <TeamTournamentRedirect /> },
      { path: "tournaments/:id/stages/:stageId", element: page(() => import("@/pages/team/tournaments/StagePage")) },
      { path: "tournaments/:id/matches", element: <TeamTournamentRedirect /> },
      { path: "tournaments/:id/matches/:matchId", element: page(() => import("@/pages/team/tournaments/TournamentMatchPage")) },
      { path: "live", element: page(() => import("@/pages/live/LiveNowPage")) },
      { path: "live/:matchId", element: page(() => import("@/pages/team/LiveViewerPage")) },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

// every route shows the friendly error screen (and recovers by itself after a new deploy)
export const router = createBrowserRouter(routes.map((r) => ({ ...r, errorElement: <RouteError /> })));


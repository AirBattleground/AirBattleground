import { useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, Clapperboard, Crosshair, Inbox, LayoutDashboard, Plus, Radio, Swords, Trophy, Users } from "lucide-react";
import type { ListResponse, PendingRequest } from "@7xen/shared";
import { api } from "@/lib/api";
import { AppShell, type MobileAction, type NavItem, type SidebarSlot, type WelcomeStep } from "@/components/shell";
import { useTournamentCrumbLabels } from "@/features/tournaments/manager/crumbs";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { OrgCard } from "@/features/manager/components/OrgCard";

const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarPlus, title: "Create a scrim", text: "Pick the maps, start time and how many slots — once or every day." },
  { icon: Users, title: "Teams register", text: "Teams find your scrim and send a request for a slot." },
  { icon: CheckCircle2, title: "Approve", text: "Approve a request and the next free slot is allotted automatically." },
];

const SEGMENT_LABELS = { new: "New scrim", edit: "Edit scrim", matches: "Matches", standings: "Points table" };

const NEW_SCRIM_FAB: MobileAction = { to: "/manager/scrims/new", label: "New scrim", icon: Plus, tour: "nav-new-scrim" };
const NEW_TOURNAMENT_FAB: MobileAction = { to: "/manager/tournaments/new", label: "New tournament", icon: Plus, tour: "nav-new-tournament" };
const NEW_TDM_FAB: MobileAction = { to: "/manager/tdm/new", label: "New TDM battle", icon: Plus, tour: "nav-new-tdm" };

export default function ManagerLayout() {
  // Same key as the Approvals page so approving/rejecting there refreshes this badge.
  const requests = useQuery({
    queryKey: ["manager", "requests"],
    // Cached as PendingRequest[] (unwrapped) — must match features/manager/api.ts, which shares this key.
    queryFn: async () => (await api.get<ListResponse<PendingRequest>>("/api/manager/requests")).items,
    refetchInterval: 30_000,
  });
  const pending = requests.data?.length ?? 0;
  const liveCount = useLiveBroadcasts().data?.length ?? 0;
  const { pathname } = useLocation();
  const tournamentLabels = useTournamentCrumbLabels();
  const inTournaments = pathname.startsWith("/manager/tournaments") || pathname.startsWith("/manager/tdm");
  // tournaments / TDM: "New …" FAB on the list only (the other tournament screens have their own primary action)
  const path = pathname.replace(/\/+$/, "");
  // the "New …" button only where you'd start one: home + the scrim / tournament / TDM lists (not on forms, Studio, etc.)
  const fab = path === "/manager/scrims" ? NEW_SCRIM_FAB : path === "/manager/tournaments" ? NEW_TOURNAMENT_FAB : path === "/manager/tdm" ? NEW_TDM_FAB : undefined;

  const orgCard: SidebarSlot = useMemo(() => (s) => <OrgCard {...s} pending={pending} />, [pending]);

  const nav: NavItem[] = [
    { key: "dashboard", to: "/manager", label: "Dashboard", short: "Home", icon: LayoutDashboard, end: true },
    { key: "requests", to: "/manager/requests", label: "Approvals", icon: Inbox, badge: pending },
    { key: "scrims", to: "/manager/scrims", label: "Scrims", icon: Swords },
    { key: "tournaments", to: "/manager/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
    { key: "tdm", to: "/manager/tdm", label: "TDM battles", short: "TDM", icon: Crosshair },
    { key: "studio", to: "/manager/studio", label: "Studio", icon: Clapperboard },
    { key: "live", to: "/manager/live", label: "Live", icon: Radio, badge: liveCount, phoneHeaderWhileBadge: true },
  ];

  return (
    <AppShell nav={nav} homeHref="/manager" sidebarAction={orgCard} mobileAction={fab} segmentLabels={tournamentLabels ?? SEGMENT_LABELS} welcomeSteps={WELCOME_STEPS}>
      <Outlet />
    </AppShell>
  );
}

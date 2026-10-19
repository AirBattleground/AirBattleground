import { Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, Inbox, LayoutDashboard, Plus, Radio, Smartphone, Swords, Trophy, Users } from "lucide-react";
import type { ListResponse, PendingRequest } from "@7xen/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { api } from "@/lib/api";
import { AppShell, type MobileAction, type NavItem, type SidebarSlot, type WelcomeStep } from "@/components/shell";
import { useTournamentCrumbLabels } from "@/features/tournaments/manager/crumbs";
import { useLiveBroadcasts } from "@/features/broadcast/live";

const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarPlus, title: "Create a scrim", text: "Pick the maps, start time and how many slots — once or every day." },
  { icon: Users, title: "Teams register", text: "Teams find your scrim and send a request for a slot." },
  { icon: CheckCircle2, title: "Approve", text: "Approve a request and the next free slot is allotted automatically." },
];

const SEGMENT_LABELS = { new: "New scrim", edit: "Edit scrim", matches: "Matches", standings: "Points table" };

/** Same fixed-icon layout as the nav rows, so collapsing just narrows the button and fades its label. */
const NewScrimButton: SidebarSlot = ({ collapsed }) => (
  <Tooltip open={collapsed ? undefined : false}>
    <TooltipTrigger asChild>
      <Link
        to="/manager/scrims/new"
        data-tour="nav-new-scrim"
        aria-label="New scrim"
        className={cn(
          "flex h-11 items-center gap-3 overflow-hidden rounded-xl bg-primary pl-4 text-sm font-semibold whitespace-nowrap text-primary-foreground shadow-glow outline-none",
          "transition-[width,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
          collapsed ? "w-[52px]" : "w-full",
        )}
      >
        <Plus className="size-5 shrink-0" />
        <span className={cn("transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}>New scrim</span>
      </Link>
    </TooltipTrigger>
    <TooltipContent side="right" sideOffset={12}>
      New scrim
    </TooltipContent>
  </Tooltip>
);

const NEW_SCRIM_FAB: MobileAction = { to: "/manager/scrims/new", label: "New scrim", icon: Plus, tour: "nav-new-scrim" };
const NEW_TOURNAMENT_FAB: MobileAction = { to: "/manager/tournaments/new", label: "New tournament", icon: Plus, tour: "nav-new-tournament" };

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
  const inTournaments = pathname.startsWith("/manager/tournaments");
  // tournaments: "New tournament" FAB on the list only (the other tournament screens have their own primary action)
  const fab = !inTournaments ? NEW_SCRIM_FAB : pathname.replace(/\/+$/, "") === "/manager/tournaments" ? NEW_TOURNAMENT_FAB : undefined;

  const nav: NavItem[] = [
    { key: "dashboard", to: "/manager", label: "Dashboard", short: "Home", icon: LayoutDashboard, end: true },
    { key: "requests", to: "/manager/requests", label: "Approvals", icon: Inbox, badge: pending },
    { key: "scrims", to: "/manager/scrims", label: "Scrims", icon: Swords },
    { key: "tournaments", to: "/manager/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
    { key: "devices", to: "/manager/devices", label: "Devices", icon: Smartphone },
    { key: "live", to: "/manager/live", label: "Live", icon: Radio, badge: liveCount, mobileOnlyWithBadge: true },
  ];

  return (
    <AppShell nav={nav} homeHref="/manager" sidebarAction={NewScrimButton} mobileAction={fab} segmentLabels={tournamentLabels ?? SEGMENT_LABELS} welcomeSteps={WELCOME_STEPS}>
      <Outlet />
    </AppShell>
  );
}

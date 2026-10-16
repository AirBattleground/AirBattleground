import { Link, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, Inbox, LayoutDashboard, Plus, Swords, Users } from "lucide-react";
import type { ListResponse, PendingRequest } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { api } from "@/lib/api";
import { AppShell, type NavItem, type SidebarSlot, type WelcomeStep } from "@/components/shell";

const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarPlus, title: "Create a scrim", text: "Pick the maps, start time and how many slots — once or every day." },
  { icon: Users, title: "Teams register", text: "Teams find your scrim and send a request for a slot." },
  { icon: CheckCircle2, title: "Approve", text: "Approve a request and the next free slot is allotted automatically." },
];

const SEGMENT_LABELS = { new: "New scrim", edit: "Edit scrim" };

const NewScrimButton: SidebarSlot = ({ collapsed, close }) => {
  const btn = (
    <Button
      asChild
      size={collapsed ? "icon-lg" : "lg"}
      className={cn("w-full shadow-glow", collapsed ? "mx-auto" : "justify-start font-semibold")}
    >
      <Link to="/manager/scrims/new" onClick={close} data-tour="nav-new-scrim" aria-label="New scrim">
        <Plus className="size-5" />
        {!collapsed && "New scrim"}
      </Link>
    </Button>
  );
  if (!collapsed) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        New scrim
      </TooltipContent>
    </Tooltip>
  );
};

export default function ManagerLayout() {
  // Same key as the Approvals page so approving/rejecting there refreshes this badge.
  const requests = useQuery({
    queryKey: ["manager", "requests"],
    // Cached as PendingRequest[] (unwrapped) — must match features/manager/api.ts, which shares this key.
    queryFn: async () => (await api.get<ListResponse<PendingRequest>>("/api/manager/requests")).items,
    refetchInterval: 30_000,
  });
  const pending = requests.data?.length ?? 0;

  const nav: NavItem[] = [
    { key: "dashboard", to: "/manager", label: "Dashboard", icon: LayoutDashboard, end: true },
    { key: "requests", to: "/manager/requests", label: "Approvals", icon: Inbox, badge: pending },
    { key: "scrims", to: "/manager/scrims", label: "Scrims", icon: Swords },
  ];

  return (
    <AppShell nav={nav} homeHref="/manager" sidebarAction={NewScrimButton} segmentLabels={SEGMENT_LABELS} welcomeSteps={WELCOME_STEPS}>
      <Outlet />
    </AppShell>
  );
}

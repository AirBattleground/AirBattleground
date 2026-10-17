import { Link, Outlet } from "react-router-dom";
import { CalendarSearch, Home, Medal, Search, Shield, Ticket, Trophy, UserPlus } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useAuth } from "@/lib/auth";
import { useIsDesktop } from "@/lib/use-media-query";
import { AppShell, type NavItem, type SidebarSlot, type WelcomeStep } from "@/components/shell";
import { useTeamTournamentCrumbLabels } from "@/features/tournaments/team/crumbs";

const PROFILE_NAV: NavItem = { key: "profile", to: "/team/profile", label: "Team profile", short: "Team", icon: Shield };

/**
 * Phones: the bottom tab bar fits 5 items, so "Team profile" moves to the avatar menu (top right) there.
 * Desktop: the sidebar shows all 6 (the team card at the top also links to the profile).
 */
const MOBILE_NAV: NavItem[] = [
  { key: "home", to: "/team", label: "Home", icon: Home, end: true },
  { key: "scrims", to: "/team/scrims", label: "Find scrims", short: "Scrims", icon: Search },
  { key: "tournaments", to: "/team/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
  { key: "registrations", to: "/team/registrations", label: "My registrations", short: "My slots", icon: Ticket },
  { key: "results", to: "/team/results", label: "Results", icon: Medal },
];
const DESKTOP_NAV: NavItem[] = [...MOBILE_NAV, PROFILE_NAV];


const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarSearch, title: "Find a scrim", text: "Pick a day and browse the scrims running that day." },
  { icon: UserPlus, title: "Register", text: "One tap sends your request to the scrim's manager." },
  { icon: Trophy, title: "Get your slot", text: "Once the manager approves, your slot number shows up right here." },
];

/** Fixed avatar position; collapsing narrows the card to the avatar and fades the text (no layout swap). */
function TeamCard({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const team = user?.team;
  if (!team) return null;
  return (
    <Tooltip open={collapsed ? undefined : false}>
      <TooltipTrigger asChild>
        <Link
          to="/team/profile"
          data-tour="team-card"
          aria-label={`${team.name} team profile`}
          className={cn(
            "group relative flex items-center gap-3 overflow-hidden rounded-xl border p-1.5 outline-none",
            "transition-[width,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
            collapsed ? "w-[52px] border-transparent bg-transparent" : "w-full border-sidebar-border bg-card/70 pr-3 hover:border-primary/40 hover:shadow-glow",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -top-10 -right-10 size-24 rounded-full bg-gradient-to-br from-primary/25 to-transparent blur-2xl transition-opacity duration-300",
              collapsed && "opacity-0",
            )}
          />
          <TeamAvatar name={team.name} tag={team.tag} size="md" />
          <span className={cn("relative min-w-0 whitespace-nowrap transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}>
            <span className="block truncate font-display text-base leading-tight font-bold">{team.name}</span>
            <span className="mt-0.5 inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] font-medium tracking-wider text-primary">
              [{team.tag}]
            </span>
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>
        {team.name} · {team.tag}
      </TooltipContent>
    </Tooltip>
  );
}

const SEGMENT_LABELS: Record<string, string> = { matches: "Match", standings: "Points table" };

const teamHeader: SidebarSlot = (s) => <TeamCard {...s} />;

export default function TeamLayout() {
  const isDesktop = useIsDesktop();
  const tournamentLabels = useTeamTournamentCrumbLabels(SEGMENT_LABELS);
  return (
    <AppShell nav={isDesktop ? DESKTOP_NAV : MOBILE_NAV} homeHref="/team" sidebarHeader={teamHeader} segmentLabels={tournamentLabels ?? SEGMENT_LABELS} welcomeSteps={WELCOME_STEPS}>
      <Outlet />
    </AppShell>
  );
}

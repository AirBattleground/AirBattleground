import { Link, Outlet } from "react-router-dom";
import { CalendarSearch, Home, Search, Shield, Ticket, Trophy, UserPlus } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { AppShell, type NavItem, type SidebarSlot, type WelcomeStep } from "@/components/shell";

const NAV: NavItem[] = [
  { key: "home", to: "/team", label: "Home", icon: Home, end: true },
  { key: "scrims", to: "/team/scrims", label: "Find scrims", icon: Search },
  { key: "registrations", to: "/team/registrations", label: "My registrations", icon: Ticket },
  { key: "profile", to: "/team/profile", label: "Team profile", icon: Shield },
];

const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarSearch, title: "Find a scrim", text: "Pick a day and browse the scrims running that day." },
  { icon: UserPlus, title: "Register", text: "One tap sends your request to the scrim's manager." },
  { icon: Trophy, title: "Get your slot", text: "Once the manager approves, your slot number shows up right here." },
];

function TeamCard({ collapsed, close }: { collapsed: boolean; close: () => void }) {
  const { user } = useAuth();
  const team = user?.team;
  if (!team) return null;
  const avatar = <TeamAvatar name={team.name} tag={team.tag} size="md" />;
  if (collapsed)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to="/team/profile" onClick={close} className="flex justify-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50" aria-label={`${team.name} team profile`}>
            {avatar}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {team.name} · {team.tag}
        </TooltipContent>
      </Tooltip>
    );
  return (
    <Link
      to="/team/profile"
      onClick={close}
      data-tour="team-card"
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-sidebar-border bg-card/70 p-3 outline-none transition-all hover:border-primary/40 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
    >
      <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 size-24 rounded-full bg-gradient-to-br from-primary/25 to-transparent blur-2xl" />
      {avatar}
      <span className="relative min-w-0">
        <span className="block truncate font-display text-base font-bold leading-tight">{team.name}</span>
        <span className="mt-0.5 inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] font-medium tracking-wider text-primary">
          [{team.tag}]
        </span>
      </span>
    </Link>
  );
}

const teamHeader: SidebarSlot = (s) => <TeamCard {...s} />;

export default function TeamLayout() {
  return (
    <AppShell nav={NAV} homeHref="/team" sidebarHeader={teamHeader} welcomeSteps={WELCOME_STEPS}>
      <Outlet />
    </AppShell>
  );
}

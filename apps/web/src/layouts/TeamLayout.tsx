import { useMemo } from "react";
import { Link, Outlet } from "react-router-dom";
import { CalendarSearch, Home, Medal, Megaphone, Plus, Radio, Search, Ticket, Trophy, Users } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { usePlayerTeam } from "@/features/player/api";
import { AppShell, type NavItem, type ShellBrand, type SidebarSlot, type WelcomeStep } from "@/components/shell";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { useTeamTournamentCrumbLabels } from "@/features/tournaments/team/crumbs";
import { useLiveBroadcasts } from "@/features/broadcast/live";

const MY_TEAM_NAV: NavItem = { key: "my-team", to: "/team/my-team", label: "My team", short: "Team", icon: Users };

/**
 * Phones: the bottom tab bar (6 items, +Live while a match is broadcast); the player profile lives in the avatar menu.
 * Desktop: the sidebar shows the same items (the team card at the top links to My team).
 */
const NAV: NavItem[] = [
  { key: "home", to: "/team", label: "Home", icon: Home, end: true },
  { key: "scrims", to: "/team/scrims", label: "Find scrims", short: "Scrims", icon: Search },
  { key: "tournaments", to: "/team/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
  { key: "registrations", to: "/team/registrations", label: "My registrations", short: "Slots", icon: Ticket },
  { key: "results", to: "/team/results", label: "Results", icon: Medal },
  // phones: in the tab bar only while something is live (the count is the badge)
  { key: "live", to: "/team/live", label: "Live", icon: Radio, mobileOnlyWithBadge: true },
  MY_TEAM_NAV,
];

const WELCOME_STEPS: WelcomeStep[] = [
  { icon: CalendarSearch, title: "Find a scrim", text: "Pick a day and browse the scrims running that day." },
  { icon: Megaphone, title: "Register", text: "Your team leader registers in one tap — members tap “Ask my leader”." },
  { icon: Trophy, title: "Get your slot", text: "Once the manager approves, your slot number shows up right here." },
];

/** Fixed avatar position; collapsing narrows the card to the avatar and fades the text (no layout swap). */
function TeamCard({ collapsed }: { collapsed: boolean }) {
  const { team } = usePlayerSession();
  if (!team) {
    return (
      <Link
        to="/team/my-team"
        data-tour="team-card"
        aria-label="Create or join a team"
        className={cn(
          "flex items-center gap-3 overflow-hidden rounded-xl border border-dashed border-primary/40 p-1.5 text-sm font-semibold text-primary outline-none transition-[width,background-color] duration-300 hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
          collapsed ? "w-[52px]" : "w-full",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <Plus className="size-5" />
        </span>
        <span className={cn("whitespace-nowrap transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}>Create or join a team</span>
      </Link>
    );
  }
  return (
    <Tooltip open={collapsed ? undefined : false}>
      <TooltipTrigger asChild>
        <Link
          to="/team/my-team"
          data-tour="team-card"
          aria-label={`${team.name} — my team`}
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
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] font-medium tracking-wider text-primary">
                [{team.tag}]
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{team.role === "LEADER" ? "Leader" : "Member"}</span>
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

const SEGMENT_LABELS: Record<string, string> = { matches: "Match", standings: "Points table", "my-team": "My team" };

const teamHeader: SidebarSlot = (s) => <TeamCard {...s} />;

const BRAND: ShellBrand = { name: "AirBattleground", wordmark: wordmarkUrl, wordmarkInk: wordmarkInkUrl, mark: markUrl };

export default function TeamLayout() {
  const tournamentLabels = useTeamTournamentCrumbLabels(SEGMENT_LABELS);
  const { hasTeam, isLeader } = usePlayerSession();
  // leader badges: open "Ask my leader" suggestions on Home, pending join requests on My team
  const myTeam = usePlayerTeam({ enabled: hasTeam && isLeader });
  const suggestions = myTeam.data?.openSuggestions ?? 0;
  const joinRequests = myTeam.data?.joinRequests.length ?? 0;
  const liveCount = useLiveBroadcasts().data?.length ?? 0;
  const nav = useMemo(
    () =>
      NAV.map((n) =>
        n.key === "home"
          ? { ...n, badge: isLeader ? suggestions : 0 }
          : n.key === "my-team"
            ? { ...n, badge: isLeader ? joinRequests : 0 }
            : n.key === "live"
              ? { ...n, badge: liveCount }
              : n,
      ),
    [isLeader, suggestions, joinRequests, liveCount],
  );
  return (
    <AppShell nav={nav} homeHref="/team" sidebarHeader={teamHeader} segmentLabels={tournamentLabels ?? SEGMENT_LABELS} welcomeSteps={WELCOME_STEPS} brand={BRAND}>
      {/* phase 5c: every page is open without a team; only registering asks for one */}
      <Outlet />
    </AppShell>
  );
}

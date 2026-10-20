import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import { CalendarSearch, Crosshair, Home, Medal, Megaphone, Radio, Search, Ticket, Trophy, Users } from "lucide-react";
import { usePlayerSession } from "@/lib/auth";
import { usePlayerTeam } from "@/features/player/api";
import { AppShell, type NavItem, type ShellBrand, type SidebarSlot, type WelcomeStep } from "@/components/shell";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { useTeamTournamentCrumbLabels } from "@/features/tournaments/team/crumbs";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { MyTeamCard } from "@/features/team/shell/MyTeamCard";
import { CoinsSidebarCard } from "@/features/coins/components/CoinsSidebarCard";
import { TeamAlerts } from "@/features/team/shell/TeamAlerts";
import { TeamSearch, type SearchPage } from "@/features/team/shell/TeamSearch";

const MY_TEAM_NAV: NavItem = { key: "my-team", to: "/team/my-team", label: "My team", short: "Team", icon: Users };

/**
 * Phones: the bottom tab bar (6 items, +Live while a match is broadcast); the player profile lives in the avatar menu.
 * Desktop: the sidebar shows the same items (the team card at the top links to My team).
 */
const NAV: NavItem[] = [
  { key: "home", to: "/team", label: "Home", icon: Home, end: true },
  { key: "scrims", to: "/team/scrims", label: "Find scrims", short: "Scrims", icon: Search },
  { key: "tournaments", to: "/team/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
  { key: "tdm", to: "/team/tdm", label: "TDM battles", short: "TDM", icon: Crosshair },
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

const SEGMENT_LABELS: Record<string, string> = { matches: "Match", standings: "Points table", "my-team": "My team", coins: "BG coins", tdm: "TDM battles" };

const teamCard: SidebarSlot = (s) => (
  <div className="flex flex-col gap-3">
    <MyTeamCard {...s} />
    <CoinsSidebarCard {...s} />
  </div>
);
const SEARCH_PAGES: SearchPage[] = [...NAV.filter((n) => n.key !== "live"), { key: "profile", to: "/team/profile", label: "My profile", icon: Users }];
const search = <TeamSearch pages={SEARCH_PAGES} />;
const alerts = <TeamAlerts />;

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
    <AppShell
      nav={nav}
      homeHref="/team"
      sidebarAction={teamCard}
      search={search}
      notifications={alerts}
      segmentLabels={tournamentLabels ?? SEGMENT_LABELS}
      welcomeSteps={WELCOME_STEPS}
      brand={BRAND}
    >
      {/* phase 5c: every page is open without a team; only registering asks for one */}
      <Outlet />
    </AppShell>
  );
}

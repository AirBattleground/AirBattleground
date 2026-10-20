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
import { common } from "@/i18n/common";
import { useT } from "@/i18n/core";

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

const SEGMENT_LABELS: Record<string, string> = { matches: "Match", standings: "Points table", "my-team": "My team", coins: "BG coins", tdm: "TDM battles" };

const teamCard: SidebarSlot = (s) => (
  <div className="flex flex-col gap-3">
    <MyTeamCard {...s} />
    <CoinsSidebarCard {...s} />
  </div>
);
const alerts = <TeamAlerts />;
/** NAV key → common.ts message key */
const NAV_MSG: Record<string, string> = { home: "home", scrims: "scrims", tournaments: "tournaments", tdm: "tdm", registrations: "registrations", results: "results", live: "live", "my-team": "my_team" };

const BRAND: ShellBrand = { name: "AirBattleground", wordmark: wordmarkUrl, wordmarkInk: wordmarkInkUrl, mark: markUrl };

export default function TeamLayout() {
  const tournamentLabels = useTeamTournamentCrumbLabels(SEGMENT_LABELS);
  const { hasTeam, isLeader } = usePlayerSession();
  // leader badges: open "Ask my leader" suggestions on Home, pending join requests on My team
  const myTeam = usePlayerTeam({ enabled: hasTeam && isLeader });
  const suggestions = myTeam.data?.openSuggestions ?? 0;
  const joinRequests = myTeam.data?.joinRequests.length ?? 0;
  const liveCount = useLiveBroadcasts().data?.length ?? 0;
  const t = useT(common);
  const nav = useMemo(
    () =>
      NAV.map((n) => {
        const k = NAV_MSG[n.key];
        const label = k ? { label: t(`nav_${k}` as Parameters<typeof t>[0]), short: t(`nav_${k}_short` as Parameters<typeof t>[0]) } : {};
        const item = { ...n, ...label };
        return n.key === "home"
          ? { ...item, badge: isLeader ? suggestions : 0 }
          : n.key === "my-team"
            ? { ...item, badge: isLeader ? joinRequests : 0 }
            : n.key === "live"
              ? { ...item, badge: liveCount }
              : item;
      }),
    [isLeader, suggestions, joinRequests, liveCount, t],
  );
  const welcomeSteps = useMemo<WelcomeStep[]>(
    () => [
      { icon: CalendarSearch, title: t("welcome_find_title"), text: t("welcome_find_text") },
      { icon: Megaphone, title: t("welcome_register_title"), text: t("welcome_register_text") },
      { icon: Trophy, title: t("welcome_slot_title"), text: t("welcome_slot_text") },
    ],
    [t],
  );
  const search = useMemo(
    () => <TeamSearch pages={[...nav.filter((n) => n.key !== "live"), { key: "profile", to: "/team/profile", label: t("nav_profile"), icon: Users }] satisfies SearchPage[]} />,
    [nav, t],
  );
  return (
    <AppShell
      nav={nav}
      homeHref="/team"
      sidebarAction={teamCard}
      search={search}
      notifications={alerts}
      segmentLabels={tournamentLabels ?? SEGMENT_LABELS}
      welcomeSteps={welcomeSteps}
      brand={BRAND}
    >
      {/* phase 5c: every page is open without a team; only registering asks for one */}
      <Outlet />
    </AppShell>
  );
}

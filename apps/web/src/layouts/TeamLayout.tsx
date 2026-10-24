import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import { BarChart3, CalendarSearch, Crown, Crosshair, Home, Medal, Megaphone, Radio, Swords, Ticket, Trophy, UserRound, Users } from "lucide-react";
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

/**
 * Phones: the bottom tab bar (5 items; TDM battles sit inside Cups); Live shows as a pill in the header while a match is broadcast. Desktop: the sidebar shows the same items.
 * My profile, My team, Statistics and Results live in the avatar menu (UserMenu); the sidebar team card links to My team.
 */
const NAV: NavItem[] = [
  { key: "home", to: "/team", label: "Home", icon: Home, end: true },
  { key: "scrims", to: "/team/scrims", label: "Find scrims", short: "Scrims", icon: Swords },
  { key: "tournaments", to: "/team/tournaments", label: "Tournaments", short: "Cups", icon: Trophy },
  { key: "registrations", to: "/team/registrations", label: "My registrations", short: "Slots", icon: Ticket },
  { key: "rank", to: "/team/rank", label: "Rank", icon: Crown },
  // phones: a LIVE pill in the header while something is live (the count is the badge), never a tab
  { key: "live", to: "/team/live", label: "Live", icon: Radio, phoneHeaderWhileBadge: true },
];

const SEGMENT_LABELS: Record<string, string> = { matches: "Match", standings: "Points table", "my-team": "My team", coins: "BG coins", tdm: "TDM battles", stats: "Statistics", results: "Results", weekly: "Weekly Board" };

const teamCard: SidebarSlot = (s) => (
  <div className="flex flex-col gap-3">
    <MyTeamCard {...s} />
    <CoinsSidebarCard {...s} />
  </div>
);
const alerts = <TeamAlerts />;
/** NAV key → common.ts message key */
const NAV_MSG: Record<string, string> = { home: "home", scrims: "scrims", tournaments: "tournaments", registrations: "registrations", rank: "rank", live: "live" };

const BRAND: ShellBrand = { name: "AirBattleground", wordmark: wordmarkUrl, wordmarkInk: wordmarkInkUrl, mark: markUrl };

export default function TeamLayout() {
  const tournamentLabels = useTeamTournamentCrumbLabels(SEGMENT_LABELS);
  const { hasTeam, isLeader } = usePlayerSession();
  // leader badge: open "Ask my leader" suggestions on Home (pending join requests show on the avatar menu)
  const myTeam = usePlayerTeam({ enabled: hasTeam && isLeader });
  const suggestions = myTeam.data?.openSuggestions ?? 0;
  const liveCount = useLiveBroadcasts().data?.length ?? 0;
  const t = useT(common);
  const nav = useMemo(
    () =>
      NAV.map((n) => {
        const k = NAV_MSG[n.key];
        const label = k ? { label: t(`nav_${k}` as Parameters<typeof t>[0]), short: t(`nav_${k}_short` as Parameters<typeof t>[0]) } : {};
        const item = { ...n, ...label };
        return n.key === "home" ? { ...item, badge: isLeader ? suggestions : 0 } : n.key === "live" ? { ...item, badge: liveCount } : item;
      }),
    [isLeader, suggestions, liveCount, t],
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
    () => (
      <TeamSearch
        pages={
          [
            ...nav.filter((n) => n.key !== "live"),
            { key: "tdm", to: "/team/tournaments/tdm", label: t("nav_tdm"), icon: Crosshair },
            // avatar-menu pages
            { key: "profile", to: "/team/profile", label: t("nav_profile"), icon: UserRound },
            { key: "my-team", to: "/team/my-team", label: t("nav_my_team"), icon: Users },
            { key: "stats", to: "/team/stats", label: t("nav_stats"), icon: BarChart3 },
            { key: "results", to: "/team/results", label: t("nav_results"), icon: Medal },
          ] satisfies SearchPage[]
        }
      />
    ),
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

import { lazy, Suspense, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Gamepad2, Hourglass, Medal, Swords, Ticket, Trophy, Users } from "lucide-react";
import { todayInAppTz, type OrganizerRef, type TeamRegistration, type TeamScrimOnDate } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ME_KEY, usePlayerSession } from "@/lib/auth";
import { useSkin } from "@/lib/skin";
import { useWatchForApproval } from "@/features/player/components/NoTeamHome";
import { TeamUpBanner } from "@/features/player/components/TeamUpBanner";
import { SuggestionsPanel } from "@/features/player/components/SuggestionsPanel";
import { useTeamDashboard } from "@/features/team/api";
import { QueryError } from "@/features/team/components/QueryError";
import { RegistrationCard, RegistrationCardSkeleton } from "@/features/team/components/RegistrationCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { FeaturedHero, NextMatchCard, type HeroStatItem } from "@/features/team/home/FeaturedHero";
import { OrganiserStrip, tallyOrganisers } from "@/features/team/home/OrganiserStrip";
import { ScrimShowcase, useHomeScrims } from "@/features/team/home/ScrimShowcase";
import { SeasonCard } from "@/features/team/home/SeasonCard";
import { SectionHeader } from "@/features/team/home/SectionHeader";
import { TournamentRail, useFeaturedTournaments } from "@/features/team/home/TournamentRail";
import { LastResultCard } from "@/features/results/components/LastResultCard";
import { TournamentsHomeCard } from "@/features/tournaments/team/components/TournamentsHomeCard";
import { NextRoomCard } from "@/features/live/components/TeamRoom";
import { CoinLeaderboard } from "@/features/coins/components/CoinLeaderboard";
import { LiveNowStrip } from "@/features/broadcast/LiveNowStrip";
import { TeamLiveCards } from "@/features/station/components/TeamLiveCard";
import { useT, type T } from "@/i18n/core";
import { dashMsg } from "@/i18n/home";

/** Lux Battle only: plane + chutes over the home hero (lazy, so Teal never loads it). */
const LuxHomeOverlay = lazy(() => import("@/skins/lux/pages/LuxHomeOverlay"));
/** Arena only: the game-lobby hero (lazy, so other looks never load it). */
const ArenaLobby = lazy(() => import("@/skins/arena/ArenaLobby"));
type DashT = T<(typeof dashMsg)["en"]>;

function teamSteps(t: DashT): TourStep[] {
  return [
    { title: t("tour_welcome_title"), description: t("tour_welcome_text") },
    { element: '[data-tour="find-scrim"]', title: t("tour_find_title"), description: t("tour_find_text"), side: "bottom" },
    { element: '[data-tour="next-match"]', title: t("tour_next_title"), description: t("tour_next_text"), side: "bottom" },
    { element: '[data-tour="stats"]', title: t("tour_stats_title"), description: t("tour_stats_text"), side: "top" },
    { element: '[data-tour="watch-live"]', title: t("tour_watch_title"), description: t("tour_watch_text"), side: "bottom" },
    { element: '[data-tour="home-live"]', title: t("tour_live_title"), description: t("tour_live_text"), side: "top" },
    { element: '[data-tour="next-room"]', title: t("tour_room_title"), description: t("tour_room_text"), side: "bottom" },
    { element: '[data-tour="team-suggestions"]', title: t("tour_sugg_title"), description: t("tour_sugg_text"), side: "top" },
    { element: '[data-tour="home-scrims"]', title: t("tour_scrims_title"), description: t("tour_scrims_text"), side: "top" },
    { element: '[data-tour="home-tournaments"]', title: t("tour_cups_title"), description: t("tour_cups_text"), side: "top" },
    { element: '[data-tour="upcoming"]', title: t("tour_upcoming_title"), description: t("tour_upcoming_text"), side: "top" },
    { element: '[data-tour="last-result"]', title: t("tour_last_title"), description: t("tour_last_text"), side: "top" },
    { element: '[data-tour="coins"]', title: t("tour_coins_title"), description: t("tour_coins_text"), side: "top" },
    { element: '[data-tour="organisers"]', title: t("tour_org_title"), description: t("tour_org_text"), side: "top" },
  ];
}

function startSteps(t: DashT): TourStep[] {
  return [
    { title: t("tour_welcome_title"), description: t("start_welcome_text") },
    { element: '[data-tour="find-scrim"]', title: t("tour_find_title"), description: t("start_find_text"), side: "bottom" },
    { element: '[data-tour="team-up"]', title: t("start_teamup_title"), description: t("start_teamup_text"), side: "bottom" },
    { element: '[data-tour="home-live"]', title: t("tour_live_title"), description: t("start_live_text"), side: "top" },
    { element: '[data-tour="home-scrims"]', title: t("tour_scrims_title"), description: t("start_scrims_text"), side: "top" },
    { element: '[data-tour="home-tournaments"]', title: t("tour_cups_title"), description: t("start_cups_text"), side: "top" },
    { element: '[data-tour="coins"]', title: t("tour_coins_title"), description: t("start_coins_text"), side: "top" },
    { element: '[data-tour="organisers"]', title: t("tour_org_title"), description: t("tour_org_text"), side: "top" },
  ];
}

function greeting(t: DashT) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (h < 12) return t("good_morning");
  if (h < 17) return t("good_afternoon");
  return t("good_evening");
}

/** The next scrim (today, then tomorrow) the team can still register for. */
function nextOpenScrim(lists: TeamScrimOnDate[][]): TeamScrimOnDate | null {
  const now = Date.now();
  for (const list of lists) {
    const hit = list.find((s) => s.registrationOpen && new Date(s.registrationClosesAt ?? s.startsAt).getTime() > now && (!s.myRegistration || s.myRegistration.status === "CANCELLED"));
    if (hit) return hit;
  }
  return null;
}

const pulse = <span className="inline-block h-6 w-10 animate-pulse rounded bg-muted align-middle" />;

/** /team: the player hub. No team yet → create / join; otherwise the team's home. */
export default function DashboardPage() {
  const { hasTeam } = usePlayerSession();
  return hasTeam ? <TeamHome /> : <StartHome />;
}

/** Phase 5c: a player without a team gets the normal hub (browse first) plus one slim "team up" nudge. */
function StartHome() {
  const t = useT(dashMsg);
  const steps = useMemo(() => startSteps(t), [t]);
  usePageTour("team.start", steps);
  const { isArena } = useSkin();
  const { user, player } = usePlayerSession();
  const profile = useWatchForApproval();
  const pending = profile.data?.pendingJoinRequest ?? null;
  const today = todayInAppTz();
  const scrims = useHomeScrims(today);
  const featured = useFeaturedTournaments();
  const organisers = useMemo(() => {
    const seen = new Set<string>();
    const fromScrims: OrganizerRef[] = [];
    for (const s of [...scrims.today.items, ...scrims.tomorrow.items]) {
      if (seen.has(s.scrim.id)) continue;
      seen.add(s.scrim.id);
      fromScrims.push(s.scrim.manager);
    }
    return tallyOrganisers(fromScrims, featured.items.map((t) => t.manager));
  }, [featured.items, scrims.today.items, scrims.tomorrow.items]);
  const startStats: HeroStatItem[] = [
    { icon: <Swords />, value: scrims.today.loading ? pulse : scrims.today.items.filter((s) => s.registrationOpen).length, label: t("stat_scrims_today") },
    { icon: <Trophy />, value: featured.loading ? pulse : featured.items.length, label: t("stat_cups_on") },
    { icon: <Users />, value: organisers.length, label: t("stat_organisers") },
  ];

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <div className="flex flex-col gap-4">
        {isArena ? (
          <Suspense fallback={<div className="h-[70vh]" />}>
            <ArenaLobby next={null} />
          </Suspense>
        ) : (
          <FeaturedHero
            eyebrow={<>{greeting(t)}, <span className="tracking-normal normal-case">{player?.ign ?? user?.displayName ?? t("player")}</span></>}
            stats={startStats}
            card={<NextMatchCard booked={null} open={nextOpenScrim([scrims.today.items, scrims.tomorrow.items])} today={today} loading={scrims.today.loading} />}
          />
        )}
        <TeamUpBanner pending={pending} />
      </div>
      {!isArena && <LiveNowStrip />}
      <ScrimShowcase data={scrims} />
      <TournamentRail {...featured} />
      <CoinLeaderboard />
      <OrganiserStrip items={organisers} />
    </div>
  );
}

function TeamHome() {
  const t = useT(dashMsg);
  const steps = useMemo(() => teamSteps(t), [t]);
  usePageTour("team.dashboard", steps);
  const { user, isLeader } = usePlayerSession();
  const { isLux, isArena } = useSkin();
  const qc = useQueryClient();
  const q = useTeamDashboard();
  const d = q.data;
  // leadership moved since the session was read → refresh it so the right buttons show
  const serverRole = d?.myTeamRole;
  const sessionRole = user?.player?.team?.role;
  useEffect(() => {
    if (serverRole && sessionRole && serverRole !== sessionRole) void qc.invalidateQueries({ queryKey: ME_KEY });
  }, [serverRole, sessionRole, qc]);
  const team = d?.team ?? user?.team ?? null;
  const today = d?.today ?? todayInAppTz();
  const upcoming: TeamRegistration[] = d ? d.upcoming.filter((r) => r.id !== d.nextMatch?.id) : [];
  const failed = q.isError && !d;
  const loading = !d && !failed;
  const booked = !!d?.nextMatch;

  const scrims = useHomeScrims(today);
  const featured = useFeaturedTournaments();

  const organisers = useMemo(() => {
    const fromScrims: OrganizerRef[] = [];
    const seen = new Set<string>();
    const scrim = (id: string, m: OrganizerRef) => {
      if (seen.has(id)) return;
      seen.add(id);
      fromScrims.push(m);
    };
    for (const s of [...scrims.today.items, ...scrims.tomorrow.items]) scrim(s.scrim.id, s.scrim.manager);
    for (const r of d ? [...(d.nextMatch ? [d.nextMatch] : []), ...d.upcoming] : []) scrim(r.scrim.id, r.scrim.manager);
    return tallyOrganisers(fromScrims, featured.items.map((t) => t.manager));
  }, [d, featured.items, scrims.today.items, scrims.tomorrow.items]);

  const showUpcoming = loading || booked || upcoming.length > 0;
  const best = d?.results?.bestRank;
  const stats: HeroStatItem[] = [
    { icon: <Gamepad2 />, value: d ? d.counts.totalPlayed : pulse, label: t("stat_played") },
    { icon: <CalendarCheck />, value: d ? d.counts.approvedUpcoming : pulse, label: t("stat_upcoming") },
    { icon: <Trophy />, value: d ? (best != null ? `#${best}` : "—") : pulse, label: t("stat_best") },
    ...(d && d.counts.pending > 0 ? [{ icon: <Hourglass />, value: d.counts.pending, label: t("stat_waiting") }] : []),
  ];

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <div className="flex flex-col gap-4">
        <div className="relative">
          {isArena ? (
            <Suspense fallback={<div className="h-[70vh]" />}>
              <ArenaLobby next={d?.nextMatch ?? null} />
            </Suspense>
          ) : (
            <FeaturedHero
              eyebrow={<>{greeting(t)}, <span className="tracking-normal normal-case">{team?.name ?? t("your_team")}</span></>}
              stats={stats}
              card={<NextMatchCard booked={d?.nextMatch ?? null} open={nextOpenScrim([scrims.today.items, scrims.tomorrow.items])} today={today} loading={loading} />}
              error={failed ? <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} className="rounded-2xl border bg-card/80 py-8 backdrop-blur-xl" /> : undefined}
            />
          )}
          {isLux && (
            <Suspense fallback={null}>
              <LuxHomeOverlay />
            </Suspense>
          )}
        </div>
        <TeamLiveCards />
        {/* Arena shows the room in the "next" strip above Find match */}
        {!isArena && <NextRoomCard />}
      </div>

      {!isArena && <LiveNowStrip />}

      {isLeader && <SuggestionsPanel />}

      <ScrimShowcase data={scrims} />

      <div className="flex flex-col gap-4">
        <TournamentRail {...featured} />
        <TournamentsHomeCard mineOnly />
      </div>

      {!failed && (
        <div className={cn("grid gap-8 sm:gap-10", showUpcoming && "lg:grid-cols-[1.15fr_1fr] lg:gap-6")}>
          {showUpcoming && (
            <section className="space-y-4" data-tour="upcoming">
              <SectionHeader eyebrow={t("sched_eyebrow")} title={t("sched_title")} icon={<Ticket />} to={upcoming.length > 0 ? "/team/registrations" : undefined} />
              {loading ? (
                <div className="space-y-3">
                  <RegistrationCardSkeleton />
                  <RegistrationCardSkeleton />
                </div>
              ) : upcoming.length === 0 ? (
                <p className="flex items-center gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
                  <CalendarCheck className="size-5 shrink-0 text-primary" />
                  <span>{t.rich("nothing_booked", { b: (c) => <span className="font-medium text-foreground">{c}</span> })}</span>
                </p>
              ) : (
                <StaggerList className="space-y-3">
                  {upcoming.slice(0, 5).map((r) => (
                    <StaggerItem key={r.id}>
                      <RegistrationCard reg={r} today={today} showDate compact cancellable={false} />
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </section>
          )}

          <section className="space-y-4">
            <SectionHeader eyebrow={t("results_eyebrow")} title={t("results_title")} icon={<Medal />} />
            <div className={cn("grid gap-4", !showUpcoming && "lg:grid-cols-2")}>
              <LastResultCard results={d?.results ?? null} loading={loading} />
              <SeasonCard results={d?.results ?? null} loading={loading} />
            </div>
          </section>
        </div>
      )}

      <CoinLeaderboard />

      <OrganiserStrip items={organisers} />
    </div>
  );
}

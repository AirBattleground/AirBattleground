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

/** Lux Battle only: plane + chutes over the home hero (lazy, so Teal never loads it). */
const LuxHomeOverlay = lazy(() => import("@/skins/lux/pages/LuxHomeOverlay"));
/** Arena only: the game-lobby hero (lazy, so other looks never load it). */
const ArenaLobby = lazy(() => import("@/skins/arena/ArenaLobby"));
const STEPS: TourStep[] = [
  { title: "Welcome to AirBattleground!", description: "This is your team's home. Here's a quick look around — it takes 20 seconds." },
  { element: '[data-tour="find-scrim"]', title: "Find a scrim", description: "Your main button: browse scrims by day and register your team.", side: "bottom" },
  { element: '[data-tour="next-match"]', title: "Your next match", description: "Once an organiser approves you, your slot number, time and maps show up here with a live countdown.", side: "bottom" },
  { element: '[data-tour="stats"]', title: "Your numbers", description: "Matches played, approved matches coming up and your best finish (plus requests still waiting, when you have some).", side: "top" },
  { element: '[data-tour="watch-live"]', title: "Watch live", description: "When one of your matches is being streamed, it shows up right here. Tap it to watch the game live.", side: "bottom" },
  { element: '[data-tour="home-live"]', title: "Live now", description: "Every match being broadcast right now, from any organiser. Tap one to watch.", side: "top" },
  { element: '[data-tour="next-room"]', title: "Room ID & password", description: "Before each match the room ID and password appear here, with copy buttons. Until then it shows when they'll appear.", side: "bottom" },
  { element: '[data-tour="team-suggestions"]', title: "Asked by your team", description: "Scrims and tournaments your members want to play. Register in one tap, or dismiss.", side: "top" },
  { element: '[data-tour="home-tournaments"]', title: "Tournaments", description: "Live cups and ones open for registration. Tap a poster for the full details and to register.", side: "top" },
  { element: '[data-tour="home-scrims"]', title: "Scrims you can join", description: "Today's and tomorrow's scrims that still take teams. Register right from here.", side: "top" },
  { element: '[data-tour="upcoming"]', title: "Everything coming up", description: "All your upcoming scrims with their status — waiting or approved with a slot.", side: "top" },
  { element: '[data-tour="last-result"]', title: "Your last result", description: "Your rank and points from the latest published scrim. Tap it for the full points table.", side: "top" },
  { element: '[data-tour="coins"]', title: "BG coins", description: "Every match winner earns BG coins for their team's leader. See the total given out and the top 10 teams.", side: "top" },
  { element: '[data-tour="organisers"]', title: "Organisers", description: "The organisers running scrims and tournaments you can play.", side: "top" },
];

const START_STEPS: TourStep[] = [
  { title: "Welcome to AirBattleground!", description: "Browse scrims and tournaments right away. You only need a team when you register." },
  { element: '[data-tour="find-scrim"]', title: "Find a scrim", description: "Browse scrims by day. Tap Register when you find one — we'll help you set up a team.", side: "bottom" },
  { element: '[data-tour="team-up"]', title: "Team up", description: "Create your own team, or join your friends with their invite code.", side: "bottom" },
  { element: '[data-tour="home-live"]', title: "Live now", description: "Every match being broadcast right now. Tap one to watch.", side: "top" },
  { element: '[data-tour="home-tournaments"]', title: "Tournaments", description: "Live cups and ones open for registration. Tap a poster for the full details.", side: "top" },
  { element: '[data-tour="home-scrims"]', title: "Scrims you can join", description: "Today's and tomorrow's scrims that still take teams.", side: "top" },
  { element: '[data-tour="coins"]', title: "BG coins", description: "Win matches to earn BG coins. See the total given out and the top 10 teams.", side: "top" },
  { element: '[data-tour="organisers"]', title: "Organisers", description: "The organisers running scrims and tournaments you can play.", side: "top" },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The next scrim (today, then tomorrow) the team can still register for. */
function nextOpenScrim(lists: TeamScrimOnDate[][]): TeamScrimOnDate | null {
  const now = Date.now();
  for (const list of lists) {
    const hit = list.find((s) => s.registrationOpen && new Date(s.startsAt).getTime() > now && (!s.myRegistration || s.myRegistration.status === "CANCELLED"));
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
  usePageTour("team.start", START_STEPS);
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
    { icon: <Swords />, value: scrims.today.loading ? pulse : scrims.today.items.filter((s) => s.registrationOpen).length, label: "Scrims open today" },
    { icon: <Trophy />, value: featured.loading ? pulse : featured.items.length, label: "Tournaments on" },
    { icon: <Users />, value: organisers.length, label: "Organisers" },
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
            eyebrow={`${greeting()}, ${player?.ign ?? user?.displayName ?? "player"}`}
            stats={startStats}
            card={<NextMatchCard booked={null} open={nextOpenScrim([scrims.today.items, scrims.tomorrow.items])} today={today} loading={scrims.today.loading} />}
          />
        )}
        <TeamUpBanner pending={pending} />
      </div>
      {!isArena && <LiveNowStrip />}
      <TournamentRail {...featured} />
      <ScrimShowcase data={scrims} />
      <CoinLeaderboard />
      <OrganiserStrip items={organisers} />
    </div>
  );
}

function TeamHome() {
  usePageTour("team.dashboard", STEPS);
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
    { icon: <Gamepad2 />, value: d ? d.counts.totalPlayed : pulse, label: "Matches played" },
    { icon: <CalendarCheck />, value: d ? d.counts.approvedUpcoming : pulse, label: "Upcoming matches" },
    { icon: <Trophy />, value: d ? (best != null ? `#${best}` : "—") : pulse, label: "Best finish" },
    ...(d && d.counts.pending > 0 ? [{ icon: <Hourglass />, value: d.counts.pending, label: "Waiting for approval" }] : []),
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
              eyebrow={`${greeting()}, ${team?.name ?? "your team"}`}
              stats={stats}
              card={<NextMatchCard booked={d?.nextMatch ?? null} open={nextOpenScrim([scrims.today.items, scrims.tomorrow.items])} today={today} loading={loading} />}
              error={failed ? <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your dashboard" className="rounded-2xl border bg-card/80 py-8 backdrop-blur-xl" /> : undefined}
            />
          )}
          {isLux && (
            <Suspense fallback={null}>
              <LuxHomeOverlay />
            </Suspense>
          )}
        </div>
        <TeamLiveCards />
        <NextRoomCard />
      </div>

      {!isArena && <LiveNowStrip />}

      {isLeader && <SuggestionsPanel />}

      <div className="flex flex-col gap-4">
        <TournamentRail {...featured} />
        <TournamentsHomeCard mineOnly />
      </div>

      <ScrimShowcase data={scrims} />

      {!failed && (
        <div className={cn("grid gap-8 sm:gap-10", showUpcoming && "lg:grid-cols-[1.15fr_1fr] lg:gap-6")}>
          {showUpcoming && (
            <section className="space-y-4" data-tour="upcoming">
              <SectionHeader eyebrow="Your schedule" title="Coming up" icon={<Ticket />} to={upcoming.length > 0 ? "/team/registrations" : undefined} />
              {loading ? (
                <div className="space-y-3">
                  <RegistrationCardSkeleton />
                  <RegistrationCardSkeleton />
                </div>
              ) : upcoming.length === 0 ? (
                <p className="flex items-center gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
                  <CalendarCheck className="size-5 shrink-0 text-primary" />
                  Nothing else booked yet. Use <span className="font-medium text-foreground">Find a scrim</span> to fill up your week.
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
            <SectionHeader eyebrow="Results" title="Your form" icon={<Medal />} />
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

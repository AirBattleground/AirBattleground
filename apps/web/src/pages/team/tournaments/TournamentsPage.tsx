import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Crosshair, Flag, Radio, Search, Ticket, Trophy } from "lucide-react";
import type { TournamentMode, TournamentSummary } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { usePlayerSession } from "@/lib/auth";
import { NoTeamHint } from "@/features/player/components/NoTeamHint";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { QueryError } from "@/features/team/components/QueryError";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { useTeamTournament, useTeamTournaments, type TournamentScope } from "@/features/tournaments/team/api";
import { FeaturedTournamentBanner, FeaturedTournamentSkeleton, useFeaturedTournament } from "@/features/tournaments/team/components/FeaturedTournamentBanner";
import { TournamentCard, TournamentCardSkeleton } from "@/features/tournaments/team/components/TournamentCard";
import { meChip } from "@/features/tournaments/team/journey";

const STEPS: TourStep[] = [
  { title: "Tournaments", description: "Multi-stage events: qualifiers, semi-finals and a grand final. Register, play your group, and climb to the trophy." },
  { element: '[data-tour="t-featured"]', title: "Featured tournament", description: "The big one. Tap to see the prize, stages and register your team.", side: "bottom" },
  { element: '[data-tour="t-tabs"]', title: "Find the right one", description: "Open = taking teams now. Live = being played. My tournaments = the ones you're in. Completed = past champions.", side: "bottom" },
  { element: '[data-tour="t-card"]', title: "Tap a tournament", description: "See the prize, how many teams registered, and which stage it's at. Tap for the full flow chart and to register.", side: "bottom" },
];

const TABS: { key: TournamentScope; label: string; icon: typeof Trophy }[] = [
  { key: "open", label: "Open", icon: Ticket },
  { key: "live", label: "Live", icon: Radio },
  { key: "mine", label: "My tournaments", icon: Trophy },
  { key: "completed", label: "Completed", icon: Flag },
];

const EMPTY: Record<TournamentScope, { title: string; description: string }> = {
  open: { title: "No open tournaments right now", description: "When an organiser opens registration for a tournament, it shows up here. Check back soon!" },
  live: { title: "Nothing live at the moment", description: "Tournaments being played right now appear here, with live standings." },
  mine: { title: "You haven't joined a tournament yet", description: "Pick an open tournament and register your team — it takes a few taps." },
  completed: { title: "No completed tournaments yet", description: "Finished tournaments and their champions will be listed here." },
};

/** "Mine" cards fetch their detail (shared cache with the hub) to show "You're in — Group C". */
function MineCard({ t, tour }: { t: TournamentSummary; tour?: boolean }) {
  const d = useTeamTournament(t.id);
  const chip = d.data ? meChip(d.data.me) : { text: "You're in", tone: "success" as const };
  return (
    <div data-tour={tour ? "t-card" : undefined} className="h-full">
      <TournamentCard t={t} chip={chip} />
    </div>
  );
}

const TDM_EMPTY: Record<TournamentScope, { title: string; description: string }> = {
  open: { title: "No open TDM battles right now", description: "When an organiser opens a TDM battle, it shows up here. Check back soon!" },
  live: { title: "No TDM battle live at the moment", description: "Battles being played right now appear here." },
  mine: { title: "You haven't joined a TDM battle yet", description: "Pick an open battle and register your team — it takes a few taps." },
  completed: { title: "No finished TDM battles yet", description: "Finished battles and their champions will be listed here." },
};

function TournamentGrid({ scope, mineIds, mode }: { scope: TournamentScope; mineIds: Set<string>; mode: TournamentMode }) {
  const { hasTeam } = usePlayerSession();
  const raw = useTeamTournaments(scope);
  const q = { ...raw, data: raw.data?.filter((t) => (t.mode ?? "BR") === mode) };
  const empty = (mode === "TDM" ? TDM_EMPTY : EMPTY)[scope];
  const base = mode === "TDM" ? "/team/tdm" : "/team/tournaments";
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title={mode === "TDM" ? "Couldn't load TDM battles" : "Couldn't load tournaments"} />;
  if (q.isLoading || !q.data)
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <TournamentCardSkeleton key={i} />
        ))}
      </div>
    );
  if (q.data.length === 0 && scope === "mine" && !hasTeam)
    return <NoTeamHint icon={<Trophy />}>{mode === "TDM" ? "TDM battles" : "Tournaments"} your team joins show up here.</NoTeamHint>;
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={mode === "TDM" ? <Crosshair /> : <Trophy />}
        title={empty.title}
        description={empty.description}
        action={
          scope === "mine" ? (
            <Button asChild size="lg">
              <Link to={`${base}?tab=open`}>
                <Search /> {mode === "TDM" ? "See open TDM battles" : "See open tournaments"}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <StaggerList className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {q.data.map((t, i) => (
        <StaggerItem key={t.id} className="h-full">
          {scope === "mine" || mineIds.has(t.id) ? (
            <MineCard t={t} tour={i === 0} />
          ) : (
            <div data-tour={i === 0 ? "t-card" : undefined} className="h-full">
              <TournamentCard t={t} />
            </div>
          )}
        </StaggerItem>
      ))}
    </StaggerList>
  );
}

const TDM_STEPS: TourStep[] = [
  { title: "TDM battles", description: "Team Deathmatch knockouts: 2 teams per match, the winner goes through, until one champion is left." },
  { element: '[data-tour="t-tabs"]', title: "Find the right one", description: "Open = taking teams now. Live = being played. My battles = the ones you're in. Completed = past champions.", side: "bottom" },
  { element: '[data-tour="t-card"]', title: "Tap a battle", description: "See the bracket, the BG coins for the champion, and register your team.", side: "bottom" },
];

export default function TournamentsPage() {
  return <TournamentsList mode="BR" />;
}

/** Player list of tournaments of one mode (BR tournaments or TDM battles). */
export function TournamentsList({ mode }: { mode: TournamentMode }) {
  usePageTour(mode === "TDM" ? "team.tdm" : "team.tournaments", mode === "TDM" ? TDM_STEPS : STEPS);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "open") as TournamentScope;
  const mine = useTeamTournaments("mine");
  const mineOfMode = useMemo(() => (mine.data ?? []).filter((t) => (t.mode ?? "BR") === mode), [mine.data, mode]);
  const mineIds = useMemo(() => new Set(mineOfMode.map((t) => t.id)), [mineOfMode]);
  const featured = useFeaturedTournament();
  const liveMine = mineOfMode.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED").length;

  return (
    <>
      <PageHeader
        eyebrow="Compete"
        title={mode === "TDM" ? "TDM battles" : "Tournaments"}
        description={
          mode === "TDM"
            ? "2 teams per match — win and you go through. The champion earns BG coins."
            : "Fight through the stages for the trophy. Spots are first come, first served."
        }
      />
      {mode === "BR" && (featured.loading ? <FeaturedTournamentSkeleton className="mb-6" /> : featured.t && featured.t.mode !== "TDM" && <FeaturedTournamentBanner t={featured.t} className="mb-6" />)}
      <Tabs value={tab} onValueChange={(v) => setParams(v === "open" ? {} : { tab: v }, { replace: true })} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-10" data-tour="t-tabs">
            {TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 px-3">
                <Icon className="size-4" />
                {label}
                {key === "mine" && liveMine > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-bold text-primary-foreground">{liveMine}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TABS.map(({ key }) => (
          <TabsContent key={key} value={key}>
            {tab === key && <TournamentGrid scope={key} mineIds={mineIds} mode={mode} />}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

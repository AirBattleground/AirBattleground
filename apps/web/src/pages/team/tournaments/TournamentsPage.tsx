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
import { useT } from "@/i18n/core";
import { tJourney, tList } from "@/i18n/tournaments";

const TABS: { key: TournamentScope; label: "tab_open" | "tab_live" | "tab_mine" | "tab_completed"; icon: typeof Trophy }[] = [
  { key: "open", label: "tab_open", icon: Ticket },
  { key: "live", label: "tab_live", icon: Radio },
  { key: "mine", label: "tab_mine", icon: Trophy },
  { key: "completed", label: "tab_completed", icon: Flag },
];

/** "Mine" cards fetch their detail (shared cache with the hub) to show "You're in — Group C". */
function MineCard({ t, tour }: { t: TournamentSummary; tour?: boolean }) {
  const d = useTeamTournament(t.id);
  const tj = useT(tJourney);
  const chip = d.data ? meChip(d.data.me, tj) : { text: tj("chip_in"), tone: "success" as const };
  return (
    <div data-tour={tour ? "t-card" : undefined} className="h-full">
      <TournamentCard t={t} chip={chip} />
    </div>
  );
}

function TournamentGrid({ scope, mineIds, mode }: { scope: TournamentScope; mineIds: Set<string>; mode: TournamentMode }) {
  const { hasTeam } = usePlayerSession();
  const tl = useT(tList);
  const raw = useTeamTournaments(scope);
  const q = { ...raw, data: raw.data?.filter((t) => (t.mode ?? "BR") === mode) };
  const ep = mode === "TDM" ? "tdm_empty_" : "empty_";
  const empty = { title: tl(`${ep}${scope}_title` as `empty_${TournamentScope}_title`), description: tl(`${ep}${scope}_desc` as `empty_${TournamentScope}_desc`) };
  const base = mode === "TDM" ? "/team/tdm" : "/team/tournaments";
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title={mode === "TDM" ? tl("err_tdm") : tl("err_tournaments")} />;
  if (q.isLoading || !q.data)
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <TournamentCardSkeleton key={i} />
        ))}
      </div>
    );
  if (q.data.length === 0 && scope === "mine" && !hasTeam)
    return <NoTeamHint icon={<Trophy />}>{mode === "TDM" ? tl("noteam_tdm") : tl("noteam_tournaments")}</NoTeamHint>;
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
                <Search /> {mode === "TDM" ? tl("see_open_tdm") : tl("see_open_tournaments")}
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

export default function TournamentsPage() {
  return <TournamentsList mode="BR" />;
}

/** Player list of tournaments of one mode (BR tournaments or TDM battles). */
export function TournamentsList({ mode }: { mode: TournamentMode }) {
  const tl = useT(tList);
  const steps = useMemo<TourStep[]>(
    () =>
      mode === "TDM"
        ? [
            { title: tl("tdm_tour_title"), description: tl("tdm_tour_desc") },
            { element: '[data-tour="t-tabs"]', title: tl("tour_tabs_title"), description: tl("tdm_tour_tabs_desc"), side: "bottom" },
            { element: '[data-tour="t-card"]', title: tl("tdm_tour_card_title"), description: tl("tdm_tour_card_desc"), side: "bottom" },
          ]
        : [
            { title: tl("tour_title"), description: tl("tour_desc") },
            { element: '[data-tour="t-featured"]', title: tl("tour_featured_title"), description: tl("tour_featured_desc"), side: "bottom" },
            { element: '[data-tour="t-tabs"]', title: tl("tour_tabs_title"), description: tl("tour_tabs_desc"), side: "bottom" },
            { element: '[data-tour="t-card"]', title: tl("tour_card_title"), description: tl("tour_card_desc"), side: "bottom" },
          ],
    [mode, tl],
  );
  usePageTour(mode === "TDM" ? "team.tdm" : "team.tournaments", steps);
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
        eyebrow={tl("eyebrow")}
        title={mode === "TDM" ? tl("title_tdm") : tl("title_br")}
        description={mode === "TDM" ? tl("desc_tdm") : tl("desc_br")}
      />
      {mode === "BR" && (featured.loading ? <FeaturedTournamentSkeleton className="mb-6" /> : featured.t && featured.t.mode !== "TDM" && <FeaturedTournamentBanner t={featured.t} className="mb-6" />)}
      <Tabs value={tab} onValueChange={(v) => setParams(v === "open" ? {} : { tab: v }, { replace: true })} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-10" data-tour="t-tabs">
            {TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 px-3">
                <Icon className="size-4" />
                {tl(label)}
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

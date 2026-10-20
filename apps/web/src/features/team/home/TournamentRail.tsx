import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import type { TournamentSummary } from "@7xen/shared";
import { TournamentCard, TournamentCardSkeleton } from "@/features/tournaments/team/components/TournamentCard";
import { useTeamTournament, useTeamTournaments } from "@/features/tournaments/team/api";
import { meChip } from "@/features/tournaments/team/journey";
import { StaggerItem, StaggerList } from "../components/Stagger";
import { SectionHeader } from "./SectionHeader";
import { useT } from "@/i18n/core";
import { homeMsg } from "@/i18n/home";
import { tJourney } from "@/i18n/tournaments";

const ACTIVE = new Set(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"]);
const ORDER: Record<string, number> = { LIVE: 0, REGISTRATION_OPEN: 1, REGISTRATION_CLOSED: 2, COMPLETED: 3 };
const RAIL_ITEM = "w-[min(20rem,82vw)] shrink-0 snap-start sm:w-[21rem] xl:w-[calc((100%-2rem)/3)] 2xl:w-[calc((100%-3rem)/4)] min-[1920px]:w-[calc((100%-4rem)/5)]";

function MineCard({ t }: { t: TournamentSummary }) {
  const tr = useT(homeMsg);
  const tj = useT(tJourney);
  const d = useTeamTournament(t.id).data;
  return <TournamentCard t={t} chip={d ? meChip(d.me, tj) : { text: tr("your_team"), tone: "brand" }} />;
}

/**
 * Featured tournaments: the team's own active ones first, then live, then open for registration.
 * Shares query keys with the tournaments page, so this is free when the user goes there.
 */
export function useFeaturedTournaments() {
  const mine = useTeamTournaments("mine");
  const feed = useTeamTournaments(); // open + live
  const mineActive = (mine.data ?? []).filter((t) => ACTIVE.has(t.status));
  const mineIds = new Set((mine.data ?? []).map((t) => t.id));
  const rest = (feed.data ?? []).filter((t) => !mineIds.has(t.id)).sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  return {
    items: [...mineActive, ...rest],
    mineIds,
    loading: mine.isLoading || feed.isLoading,
  };
}

export function TournamentRail({ items, mineIds, loading }: ReturnType<typeof useFeaturedTournaments>) {
  const tr = useT(homeMsg);
  return (
    <section className="space-y-4" data-tour="home-tournaments">
      <SectionHeader eyebrow={tr("cups_eyebrow")} title={tr("cups_title")} description={tr("cups_text")} icon={<Trophy />} to="/team/tournaments" />
      {loading ? (
        <div className="home-rail -mx-4 flex gap-4 overflow-hidden px-4 sm:mx-0 sm:px-0">
          {[0, 1, 2].map((i) => (
            <div key={i} className={RAIL_ITEM}>
              <TournamentCardSkeleton />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-dashed bg-card/60 p-6 text-center backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
          <Trophy className="relative mx-auto size-10 text-primary/70" />
          <p className="relative mt-2 font-display text-xl font-bold">{tr("no_cups_title")}</p>
          <p className="relative mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {tr.rich("no_cups_text", {
              link: (c) => (
                <Link to="/team/tournaments" className="font-semibold text-primary hover:underline">
                  {c}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : (
        <StaggerList className="home-rail -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pt-1 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {items.slice(0, 8).map((t) => (
            <StaggerItem key={t.id} className={cn(RAIL_ITEM, "[&>.tc-card]:shadow-xl [&>.tc-card]:shadow-background/60")}>
              {mineIds.has(t.id) ? <MineCard t={t} /> : <TournamentCard t={t} />}
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}

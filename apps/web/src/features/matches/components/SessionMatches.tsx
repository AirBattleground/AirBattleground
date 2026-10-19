import { Link } from "react-router-dom";
import { ArrowRight, Image as ImageIcon, Loader2, Trophy, Users } from "lucide-react";
import type { MatchSummary } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { useSessionMatches } from "../api";
import { MatchStatusPill } from "./MatchStatusPill";

const NEXT_STEP: Record<MatchSummary["status"], string> = {
  SCHEDULED: "Upload the team list screenshots",
  LINEUP_REVIEW: "Check names and confirm the lineup",
  LIVE: "Upload the final results screenshots",
  RESULTS_REVIEW: "Check ranks & finishes, then publish",
  PUBLISHED: "Done — teams can see the results",
};

/** "Matches & results" for one session: one card per map, links into the match center. */
export function SessionMatches({ scrimId, date }: { scrimId: string; date: string }) {
  const q = useSessionMatches(scrimId, date);
  const base = `/manager/scrims/${scrimId}/${date}`;

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load the matches" />;

  const published = q.data?.filter((m) => m.status === "PUBLISHED").length ?? 0;

  return (
    <section data-tour="detail-matches" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl font-bold">Matches & results</h2>
          <p className="text-sm text-muted-foreground">
            One match per map. Upload in-game screenshots and AirBattleground fills in the results for you.
          </p>
        </div>
        <Button asChild variant="outline" data-tour="detail-standings">
          <Link to={`${base}/standings`}>
            <Trophy /> Points table{q.data ? ` (${published}/${q.data.length})` : ""}
          </Link>
        </Button>
      </div>

      {!q.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : q.data.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">This scrim has no maps, so there are no matches. Add maps from Edit.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((m) => (
            <li key={m.id}>
              <Link
                to={`${base}/matches/${m.id}`}
                className={cn(
                  "group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  m.status === "PUBLISHED" && "border-success/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-3xl font-bold leading-none">Match {m.number}</p>
                    <MapChip map={m.map} className="mt-2" />
                  </div>
                  <MatchStatusPill status={m.status} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="size-3.5" /> {m.screenshotCounts.slotList} team list · {m.screenshotCounts.results} results
                  </span>
                  {m.teamsInLineup > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" /> {m.teamsInLineup} teams
                    </span>
                  )}
                  {m.screenshotCounts.processing > 0 && (
                    <span className="inline-flex items-center gap-1 text-info">
                      <Loader2 className="size-3.5 animate-spin" /> Reading {m.screenshotCounts.processing}
                    </span>
                  )}
                  {m.screenshotCounts.failed > 0 && <span className="text-destructive">{m.screenshotCounts.failed} couldn't be read</span>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                  <span className="text-sm text-muted-foreground">{NEXT_STEP[m.status]}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
                    Open match center <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

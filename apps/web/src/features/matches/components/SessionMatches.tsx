import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Trophy } from "lucide-react";
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
  PUBLISHED: "Published",
};

/** "Matches & results" for one session: one card per map, links into the match center. */
export function SessionMatches({ scrimId, date }: { scrimId: string; date: string }) {
  const q = useSessionMatches(scrimId, date);
  const base = `/manager/scrims/${scrimId}/${date}`;

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load the matches" />;

  const published = q.data?.filter((m) => m.status === "PUBLISHED").length ?? 0;

  return (
    <section data-tour="detail-matches" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Matches{q.data ? ` · ${published}/${q.data.length} published` : ""}
        </p>
        <Button asChild variant="outline" size="sm" data-tour="detail-standings">
          <Link to={`${base}/standings`}>
            <Trophy /> Points table
          </Link>
        </Button>
      </div>

      {!q.data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : q.data.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No maps on this scrim. Add maps from Edit.</p>
      ) : (
        <ul className="-mx-2 divide-y">
          {q.data.map((m) => (
            <li key={m.id}>
              <Link
                to={`${base}/matches/${m.id}`}
                className="group flex min-h-14 items-center gap-3 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="w-9 shrink-0 font-display text-2xl font-bold leading-none tabular-nums">{m.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <MapChip map={m.map} />
                    {m.screenshotCounts.processing > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-info">
                        <Loader2 className="size-3.5 animate-spin" /> Reading
                      </span>
                    )}
                    {m.screenshotCounts.failed > 0 && <span className="text-xs text-destructive">{m.screenshotCounts.failed} unread</span>}
                  </span>
                  <span className={cn("mt-0.5 block truncate text-xs", m.status === "PUBLISHED" ? "text-success" : "text-muted-foreground")}>
                    {NEXT_STEP[m.status]}
                  </span>
                </span>
                <MatchStatusPill status={m.status} className="hidden sm:inline-flex" />
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

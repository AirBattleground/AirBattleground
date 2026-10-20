import { Crosshair } from "lucide-react";
import type { MatchScorecard } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { resultsMsg } from "@/i18n/results";
import { PODIUM, RankBadge } from "./Rank";

type Row = MatchScorecard["teams"][number];

/** Every team's result in one match, by rank. Own team highlighted. */
export function ScorecardList({ teams, highlightTeamId }: { teams: Row[]; highlightTeamId?: string }) {
  const t = useT(resultsMsg);
  const rows = [...teams].sort((a, b) => a.rank - b.rank);
  return (
    <ol className="space-y-2" data-tour="scorecard-list">
      {rows.map((row) => {
        const mine = row.team.id === highlightTeamId;
        return (
          <li
            key={row.slotNumber}
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-card p-3 shadow-sm sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)_auto] sm:gap-4",
              PODIUM[row.rank]?.row,
              mine && "border-primary/60 bg-primary/10 shadow-glow",
            )}
            aria-current={mine ? "true" : undefined}
          >
            <RankBadge rank={row.rank} size="md" />
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamAvatar name={row.team.name} tag={row.team.tag} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {row.team.name}
                  {mine && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">{t("you")}</span>}
                </p>
                <p className="font-display text-xs font-semibold text-muted-foreground">{t("slot_n", { n: String(row.slotNumber).padStart(2, "0") })}</p>
              </div>
            </div>
            <div className="col-span-3 row-start-2 flex flex-wrap gap-1.5 sm:col-span-1 sm:row-start-auto">
              {row.players.length === 0 && <span className="text-xs text-muted-foreground">{t("no_players")}</span>}
              {row.players.map((p, i) => (
                <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background/70 px-2 py-1 text-xs">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className={cn("font-display font-bold tabular-nums", p.kills ? "text-primary" : "text-muted-foreground")}>{p.kills ?? "–"}</span>
                </span>
              ))}
            </div>
            <div className="col-start-3 row-start-1 flex items-center gap-4 text-right sm:col-start-auto sm:row-start-auto">
              <div className="hidden sm:block">
                <p className="flex items-center justify-end gap-1 font-display text-lg font-bold tabular-nums">
                  <Crosshair className="size-3.5 text-muted-foreground" /> {row.kills}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("stat_finishes")}</p>
              </div>
              <div>
                <p className="font-display text-3xl font-bold leading-none tabular-nums">{row.totalPoints}</p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">
                  {row.placementPoints} + {row.killPoints} {t("pts")}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

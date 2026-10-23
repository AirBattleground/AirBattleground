import type { ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Crosshair, Crown, Trophy } from "lucide-react";
import { addDays, type WeeklyBoard } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { PointsLegend, StandingsBoard } from "@/features/results/components/Standings";
import { ChickenDinner } from "@/features/results/components/Rank";
import { useDateFormat, useT } from "@/i18n/core";
import { resultsMsg } from "@/i18n/results";
import { weeklyMsg } from "@/i18n/weekly";

type Match = WeeklyBoard["matches"][number];

const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase", className)}>{children}</p>
);

/** "12 – 16 Oct" */
export function useWeekRange() {
  const fmt = useDateFormat();
  return (b: WeeklyBoard["week"]) => (b.start.slice(5, 7) === b.end.slice(5, 7) ? `${fmt(b.start, "d")} – ${fmt(b.end, "d MMM")}` : `${fmt(b.start, "d MMM")} – ${fmt(b.end, "d MMM")}`);
}

function WeekBar({ board, onWeek, fetching }: { board: WeeklyBoard; onWeek: (week: string) => void; fetching?: boolean }) {
  const t = useT(weeklyMsg);
  const range = useWeekRange();
  const played = board.matches.filter((m) => m.status === "PUBLISHED").length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t("prev_week")} onClick={() => onWeek(addDays(board.week.start, -7))}>
          <ChevronLeft />
        </Button>
        <div className={cn("min-w-36 px-1 text-center transition-opacity", fetching && "opacity-60")}>
          <p className="flex items-center justify-center gap-1.5 font-display text-xl leading-tight font-bold">
            <CalendarDays className="size-4 text-primary" /> {range(board.week)}
          </p>
          <p className="text-xs text-muted-foreground">{board.week.current ? t("this_week") : " "}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("next_week")} disabled={board.week.current} onClick={() => onWeek(addDays(board.week.start, 7))}>
          <ChevronRight />
        </Button>
        {!board.week.current && (
          <Button variant="outline" size="sm" className="ml-1" onClick={() => onWeek("")}>
            {t("this_week")}
          </Button>
        )}
      </div>
      <dl className="flex items-end gap-6 pr-1">
        <div>
          <dt>
            <Label>{t("nights_played")}</Label>
          </dt>
          <dd className="font-display text-2xl font-bold tabular-nums">
            {played}
            <span className="text-base text-muted-foreground">/{board.matches.length}</span>
          </dd>
        </div>
        <div>
          <dt>
            <Label>{t("teams")}</Label>
          </dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{board.rows.length}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The week's #1: who leads (or won) and what the Finals Slot looks like. */
function LeaderCard({ board, highlightTeamId, leaderAction }: { board: WeeklyBoard; highlightTeamId?: string; leaderAction?: ReactNode }) {
  const t = useT(weeklyMsg);
  const tr = useT(resultsMsg);
  const top = board.rows[0]!;
  const slot = board.finalsSlot;
  const mine = top.team.id === highlightTeamId;
  return (
    <section
      data-tour="weekly-leader"
      className="relative overflow-hidden rounded-2xl border border-warning/40 bg-card p-4 shadow-sm sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-warning/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="relative shrink-0">
            <TeamAvatar name={top.team.name} tag={top.team.tag} size="lg" className="size-16 rounded-2xl text-lg sm:size-20 sm:text-xl" />
            <span className="absolute -top-3 -right-3 flex size-8 items-center justify-center rounded-full bg-warning text-warning-foreground shadow-lg">
              <Crown className="size-4" />
            </span>
          </div>
          <div className="min-w-0">
            <Label className="text-warning-foreground dark:text-warning">{board.week.over ? t("winner") : t("leading")}</Label>
            <h2 className="truncate font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">{top.team.name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                <span className="font-display text-2xl font-bold text-foreground tabular-nums">{top.totalPoints}</span> {t("pts")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Crosshair className="size-4" /> {top.kills}
              </span>
              {top.wins > 0 && <ChickenDinner count={top.wins} />}
              {mine && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">{tr("you")}</span>}
            </p>
          </div>
        </div>

        <div className="md:w-80 md:shrink-0">
          {slot ? (
            <div className="rounded-xl border border-warning/60 bg-gradient-to-br from-warning/25 via-warning/10 to-transparent p-4 shadow-glow">
              <p className="flex items-center gap-2 font-display text-2xl leading-none font-extrabold text-warning-foreground uppercase dark:text-warning">
                <Trophy className="size-6" /> {t("finals_slot")}
              </p>
              <p className="mt-2 text-sm font-semibold">{t("finals_in", { stage: slot.stageName, tournament: slot.tournament.title })}</p>
            </div>
          ) : board.week.over && leaderAction ? (
            leaderAction
          ) : (
            <div className="rounded-xl border border-dashed border-warning/50 p-4">
              <p className="flex items-center gap-2 font-display text-lg leading-tight font-bold uppercase">
                <Trophy className="size-5 text-warning" /> {t("finals_slot")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{board.week.over ? t("hint_wait") : t("hint_live")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface Props {
  board: WeeklyBoard;
  onWeek: (week: string) => void;
  fetching?: boolean;
  highlightTeamId?: string;
  /** manager: what to show in place of the Finals Slot once the week is over and it isn't given yet */
  leaderAction?: ReactNode;
  /** link a night's column somewhere */
  nightHref?: (m: Match, date: string) => string | undefined;
}

/** Week switcher, the week's #1, the night-by-night table and how it works. */
export function WeeklyBoardView({ board, onWeek, fetching, highlightTeamId, leaderAction, nightHref }: Props) {
  const t = useT(weeklyMsg);
  const fmt = useDateFormat();
  const dayOf = (m: Match) => board.week.days[m.number - 1]!;
  return (
    <div className="space-y-4">
      <WeekBar board={board} onWeek={onWeek} fetching={fetching} />
      {board.rows.length === 0 ? (
        <EmptyState icon={<Trophy />} title={t("no_results")} description={t("no_results_desc")} />
      ) : (
        <>
          <LeaderCard board={board} highlightTeamId={highlightTeamId} leaderAction={leaderAction} />
          <div data-tour="weekly-table">
            <StandingsBoard
              standings={board}
              highlightTeamId={highlightTeamId}
              matchLabel={(m) => fmt(dayOf(m), "EEE d").toUpperCase()}
              matchHref={nightHref ? (m) => (m.status === "PUBLISHED" ? nightHref(m, dayOf(m)) : undefined) : undefined}
            />
          </div>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <Label>{t("how_title")}</Label>
          <p className="mt-2 text-sm text-muted-foreground">{t("how_desc")}</p>
        </section>
        <PointsLegend ps={board.pointsSystem} />
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock, Info, ListOrdered, Lock, Medal, Swords, Trophy, Users } from "lucide-react";
import { ApiError, APP_TIMEZONE, todayInAppTz, type TeamScrimDetail } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { useTeamScrimDetail } from "@/features/team/api";
import { ScrimCard } from "@/features/team/components/ScrimCard";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useDayFormat } from "@/features/team/format";
import { RoomValue } from "@/features/live/components/RoomValue";
import { fmtClock } from "@/features/live/format";
import { PointsLegend } from "@/features/results/components/Standings";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";
import { resultsMsg } from "@/i18n/results";
import { scrimDetailMsg } from "@/i18n/scrimDetail";

const time = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" });

/** Card with a small uppercase label, like the rest of the team portal. */
function Section({ icon, title, aside, tour, children, className }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; tour?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-tour={tour} className={cn("rounded-2xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase [&_svg]:size-3.5">
          {icon} {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The day's matches: map, time, and my team's room (copy) or when it appears. */
function Matches({ d }: { d: TeamScrimDetail }) {
  const t = useT(scrimDetailMsg);
  const tl = useT(liveMsg);
  const approved = d.myRegistration?.status === "APPROVED";
  const upcoming = d.matches.some((m) => !m.published);
  return (
    <Section icon={<Swords />} title={t("matches")} tour="scrim-matches">
      <ol className="divide-y rounded-xl border bg-background/50">
        {d.matches.map((m) => (
          <li key={m.number} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-base font-bold text-primary">M{m.number}</span>
              <div className="min-w-0">
                <p className="font-display text-lg leading-tight font-bold">{t("match_n", { n: m.number })}</p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapChip map={m.map} className="px-1.5 py-0.5 text-[11px]" />
                  {m.startsAt && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" /> {time.format(new Date(m.startsAt))}
                    </span>
                  )}
                </p>
              </div>
            </div>
            {m.published ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" /> {t("published")}
              </span>
            ) : m.room ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 sm:pl-0">
                <RoomValue label="ID" value={m.room.roomId} copyLabel={tl("copy_room_id")} />
                <RoomValue label="PASS" value={m.room.password} copyLabel={tl("copy_password")} />
              </div>
            ) : approved ? (
              <span className="inline-flex items-center gap-1.5 pl-12 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:pl-0">
                <Lock className="size-3.5 text-primary" /> {m.revealAt ? tl("room_at_short", { time: fmtClock(m.revealAt) }) : tl("room_not_shared")}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {!approved && upcoming && (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" /> {t("rooms_hint")}
        </p>
      )}
    </Section>
  );
}

/** Teams that already have a slot, by slot number; mine highlighted. */
function Lobby({ d }: { d: TeamScrimDetail }) {
  const t = useT(scrimDetailMsg);
  const tr = useT(resultsMsg);
  const { team } = usePlayerSession();
  return (
    <Section icon={<Users />} title={t("lobby")} tour="scrim-lobby" aside={<span className="text-xs text-muted-foreground tabular-nums">{t("lobby_count", { n: d.lobby.length, total: d.scrim.slotCount })}</span>}>
      {d.lobby.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("lobby_empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.lobby.map((l) => {
            const mine = l.team.id === team?.id;
            return (
              <li key={l.slotNumber} className={cn("flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2", mine && "border-primary/60 bg-primary/10")}>
                <span className="w-9 shrink-0 font-display text-lg font-bold text-primary tabular-nums">#{String(l.slotNumber).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{l.team.name}</span>
                {mine ? (
                  <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">{tr("you")}</span>
                ) : (
                  <span className="font-mono text-[11px] tracking-wider text-muted-foreground">{l.team.tag}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Other days this scrim runs (switching keeps you on the page). */
function Days({ d, scrimId }: { d: TeamScrimDetail; scrimId: string }) {
  const t = useT(scrimDetailMsg);
  const { dayLabel } = useDayFormat();
  const today = todayInAppTz();
  const days = d.dates.includes(d.date) ? d.dates : [d.date, ...d.dates];
  if (days.length < 2) return null;
  return (
    <nav aria-label={t("days")} data-tour="scrim-days" className="home-rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {days.map((day) => (
        <Link
          key={day}
          to={`/team/scrims/${scrimId}?date=${day}`}
          replace
          aria-current={day === d.date ? "date" : undefined}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            day === d.date ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {day === d.date && <CalendarDays className="size-3.5" />}
          {dayLabel(day, today)}
        </Link>
      ))}
    </nav>
  );
}

/** A row link to another page (Weekly Board, points table). */
function LinkRow({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg leading-tight font-bold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** /team/scrims/:scrimId?date= — one scrim on one day: register, matches + rooms, lobby, rules, other days. */
export default function ScrimDetailPage() {
  const t = useT(scrimDetailMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_title"), description: t("tour_desc") },
      { element: '[data-tour="scrim-days"]', title: t("tour_days_title"), description: t("tour_days_desc"), side: "bottom" },
      { element: '[data-tour="scrim-matches"]', title: t("tour_matches_title"), description: t("tour_matches_desc"), side: "top" },
      { element: '[data-tour="scrim-lobby"]', title: t("tour_lobby_title"), description: t("tour_lobby_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.scrim", steps);
  const { scrimId = "" } = useParams();
  const [params] = useSearchParams();
  const q = useTeamScrimDetail(scrimId, params.get("date") ?? "");
  const d = q.data;

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={d ? `/team/scrims?date=${d.date}` : "/team/scrims"}>
        <ArrowLeft /> {t("back")}
      </Link>
    </Button>
  );

  if (q.isError) {
    return (
      <>
        {back}
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState
            icon={<Swords />}
            title={t("gone_title")}
            description={t("gone_desc")}
            action={
              <Button asChild>
                <Link to="/team/scrims">{t("see_scrims")}</Link>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        )}
      </>
    );
  }
  if (!d) {
    return (
      <>
        {back}
        <div className="space-y-4">
          <Skeleton className="h-9 w-72 rounded-full" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </>
    );
  }

  const approved = d.myRegistration?.status === "APPROVED";
  return (
    <>
      {back}
      <h1 className="sr-only">{d.scrim.title}</h1>
      <div className="space-y-4">
        <Days d={d} scrimId={scrimId} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="space-y-4">
            {/* wrapper: the card fills its container (h-full, for list grids); here it should only be as tall as its content */}
            <div>
              <ScrimCard item={d} rejectionReason={d.myRegistration?.rejectionReason} linkTitle={false} />
            </div>
            <Matches d={d} />
            <Lobby d={d} />
          </div>
          <div className="space-y-4">
            {(d.scrim.description || d.scrim.winCoins > 0) && (
              <Section icon={<Info />} title={t("about")}>
                {d.scrim.description && <p className="text-sm whitespace-pre-line">{d.scrim.description}</p>}
                {d.scrim.winCoins > 0 && (
                  <p className={cn("flex items-center gap-2 text-sm font-semibold text-warning-foreground dark:text-warning", d.scrim.description && "mt-3")}>
                    <Trophy className="size-4 shrink-0" /> {t("win_coins", { coins: d.scrim.winCoins })}
                  </p>
                )}
              </Section>
            )}
            <PointsLegend ps={d.scrim.pointsSystem} />
            {approved && d.publishedMatches > 0 && (
              <LinkRow to={`/team/results/${scrimId}/${d.date}`} icon={<ListOrdered />} title={t("results")} desc={t("results_desc", { n: d.publishedMatches, total: d.matches.length })} />
            )}
            {d.scrim.recurrence !== "ONCE" && <LinkRow to={`/team/weekly/${scrimId}?week=${d.date}`} icon={<Medal />} title={t("weekly")} desc={t("weekly_desc")} />}
          </div>
        </div>
      </div>
    </>
  );
}

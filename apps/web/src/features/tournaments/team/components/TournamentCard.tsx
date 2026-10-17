import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crown, Layers, Trophy, User } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { Pill, TeamAvatar, type Tone } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { Countdown } from "../../shared/Countdown";
import { RegistrationMeter } from "../../shared/RegistrationMeter";
import { LiveDot, StatusPill, STAGE_STATUS_LABELS } from "../../shared/StatusPill";
import { fmtDay, fmtWhen } from "../../shared/format";

/** Tiny stage progress: one segment per stage, current one glowing. */
export function StageDots({ count, current, live }: { count: number; current: number | null; live?: boolean }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const order = i + 1;
        const done = current != null && order < current;
        const cur = current === order;
        return (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              cur ? cn("w-6", live ? "bg-destructive" : "bg-primary") : "w-3",
              done && "bg-success",
              !cur && !done && "bg-muted-foreground/25",
            )}
          />
        );
      })}
    </span>
  );
}

export interface TournamentCardProps {
  t: TournamentSummary;
  /** e.g. "You're in — Group C" */
  chip?: { text: string; tone: Tone } | null;
  className?: string;
}

/** Rich list card: status, prize, dates, registration meter / current stage / champion, "you're in" chip. */
export function TournamentCard({ t, chip, className }: TournamentCardProps) {
  const open = t.status === "REGISTRATION_OPEN";
  const live = t.status === "LIVE";
  return (
    <Link
      to={`/team/tournaments/${t.id}`}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm outline-none transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50",
        live && "border-destructive/30",
        className,
      )}
    >
      <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary/15 via-transparent to-transparent px-4 pt-4 pb-3.5">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
        <Trophy className="pointer-events-none absolute -right-3 -bottom-4 size-24 rotate-12 text-primary/10 transition-transform duration-500 group-hover:rotate-6 group-hover:scale-110" />
        <div className="relative flex flex-wrap items-center gap-1.5">
          <StatusPill status={t.status} />
          {chip && (
            <Pill tone={chip.tone} className="font-bold">
              {chip.text}
            </Pill>
          )}
        </div>
        <h3 className="relative mt-2.5 line-clamp-2 font-display text-2xl leading-tight font-bold">{t.title}</h3>
        {t.prize && (
          <p className="relative mt-1 inline-flex items-center gap-1.5 font-display text-lg font-bold text-warning-foreground dark:text-warning">
            <Trophy className="size-4" /> {t.prize}
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5 text-primary" /> {t.startsAt ? `Starts ${fmtDay(t.startsAt)}` : "Dates TBA"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3.5 text-primary" /> {t.stagesCount} {t.stagesCount === 1 ? "stage" : "stages"}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <User className="size-3.5 text-primary" /> <span className="truncate">{t.manager.displayName}</span>
          </span>
        </div>

        <div className="mt-auto">
          {open || t.status === "REGISTRATION_CLOSED" ? (
            <>
              <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} size="sm" />
              {open && t.registrationClosesAt && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Closes in <Countdown to={t.registrationClosesAt} className="font-semibold text-foreground" doneText="moments" /> · {fmtWhen(t.registrationClosesAt)}
                </p>
              )}
            </>
          ) : t.status === "COMPLETED" && t.champion ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-2.5">
              <TeamAvatar name={t.champion.name} tag={t.champion.tag} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold tracking-wider text-warning-foreground uppercase dark:text-warning">Champion</p>
                <p className="truncate font-semibold">{t.champion.name}</p>
              </div>
              <Crown className="size-5 text-warning-foreground dark:text-warning" />
            </div>
          ) : t.currentStage ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Now</p>
                <p className="flex items-center gap-1.5 truncate font-display text-base font-bold">
                  {t.currentStage.status === "LIVE" && <LiveDot className="text-destructive" />}
                  {t.currentStage.name}
                  <span className="text-xs font-medium text-muted-foreground">· {STAGE_STATUS_LABELS[t.currentStage.status]}</span>
                </p>
              </div>
              <StageDots count={t.stagesCount} current={t.currentStage.order} live={t.currentStage.status === "LIVE"} />
            </div>
          ) : null}
        </div>

        <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          {open && !chip ? "View & register" : "Open tournament"}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}

export function TournamentCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="space-y-2.5 border-b p-4">
        <div className="h-5 w-28 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-3/4 animate-pulse rounded-md bg-muted" />
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

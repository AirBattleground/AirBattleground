import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crown, Layers, Trophy, Users } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { Pill, TeamAvatar, type Tone } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { OrganizerBadge } from "@/features/team/components/Branding";
import { CardSegment, HudCorners } from "@/features/team/components/CardSegment";
import { useCardTilt } from "@/features/team/useCardTilt";
import { Countdown } from "../../shared/Countdown";
import { RegistrationMeter } from "../../shared/RegistrationMeter";
import { LiveDot, StatusPill, STAGE_STATUS_LABELS } from "../../shared/StatusPill";
import { fmtDay, fmtWhen } from "../../shared/format";

/** Tiny stage progress: one segment per stage, current one glowing. */
function StageDots({ count, current, live }: { count: number; current: number | null; live?: boolean }) {
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

/** Square poster bleeding into the card: drifts slowly, zooms on hover, fades out at the bottom. */
function PosterArt({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="tc-poster pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden>
        <div className="tc-aurora absolute -top-16 -left-10 size-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="tc-aurora absolute -top-10 right-0 size-44 rounded-full bg-warning/25 blur-3xl [animation-delay:-6s]" />
        <div className="absolute inset-0 bg-grid opacity-70" />
        <Trophy className="absolute -top-2 -right-6 size-44 rotate-12 text-primary/15 transition-transform duration-700 group-hover:rotate-3 group-hover:scale-110" />
      </div>
    );
  }
  return (
    <div className="tc-poster pointer-events-none absolute inset-x-0 top-0 h-[17rem] overflow-hidden sm:h-72" aria-hidden>
      <div className="tc-poster-zoom size-full">
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover object-top" />
      </div>
      {/* left wash keeps the title readable over busy art, in both themes */}
      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
      <div className="tc-scan absolute inset-0 opacity-60" />
    </div>
  );
}

interface TournamentCardProps {
  t: TournamentSummary;
  /** e.g. "You're in — Group C" */
  chip?: { text: string; tone: Tone } | null;
  className?: string;
}

/** Game-style list card: poster art melting into the card, segmented specs, live state, animated CTA. */
export function TournamentCard({ t, chip, className }: TournamentCardProps) {
  const open = t.status === "REGISTRATION_OPEN";
  const live = t.status === "LIVE";
  const tilt = useCardTilt<HTMLAnchorElement>();
  return (
    <Link
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      to={`/team/tournaments/${t.id}`}
      data-live={live}
      className={cn(
        "tc-card group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm outline-none",
        "hover:border-transparent hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50",
        live && "border-destructive/40",
        className,
      )}
    >
      <PosterArt url={t.posterUrl} />
      <div className="tc-sheen pointer-events-none absolute inset-0 z-20" aria-hidden />
      <HudCorners />

      {/* hero: status + organiser on top, title + prize sitting on the faded art */}
      <div className="relative z-10 flex min-h-[13.5rem] flex-col justify-between gap-6 px-4 pt-4 sm:min-h-60 sm:px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 [&>*]:shadow-sm [&>*]:backdrop-blur-md">
            <StatusPill status={t.status} />
            {chip && (
              <Pill tone={chip.tone} className="font-bold">
                {chip.text}
              </Pill>
            )}
          </div>
          <OrganizerBadge
            manager={t.manager}
            className="max-w-[45%] shrink-0 rounded-full border bg-background/70 py-0.5 pr-2.5 pl-0.5 text-[11px] font-semibold shadow-sm backdrop-blur-md"
            iconClassName="ml-1.5 size-3.5 text-primary"
            logoClassName="size-5 rounded-full"
            nameClassName="truncate"
          />
        </div>
        <div className="drop-shadow-[0_1px_8px_var(--card)]">
          {t.prize && (
            <p className="mb-1 inline-flex items-center gap-1.5">
              <span className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">Prize pool</span>
              <span className="tc-prize font-display text-xl font-extrabold text-warning-foreground dark:text-warning">{t.prize}</span>
            </p>
          )}
          <h3 className="line-clamp-2 font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight uppercase transition-colors duration-300 group-hover:text-primary sm:text-3xl">
            {t.title}
          </h3>
        </div>
      </div>

      {/* segmented specs */}
      <div className="relative z-10 mx-4 mt-4 grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-background/70 backdrop-blur-md sm:mx-5">
        <CardSegment icon={CalendarDays} label="Starts" value={t.startsAt ? fmtDay(t.startsAt) : "TBA"} delay={80} />
        <CardSegment icon={Layers} label="Stages" value={t.stagesCount} delay={160} />
        <CardSegment icon={Users} label="Teams" value={`${t.confirmedCount}/${t.maxTeams}`} delay={240} />
      </div>

      {/* state */}
      <div className="relative z-10 flex flex-1 flex-col px-4 pt-3 pb-4 sm:px-5">
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
            <div className="relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-warning/40 bg-warning/10 p-2.5">
              <span className="pointer-events-none absolute inset-0 animate-shine bg-[linear-gradient(110deg,transparent_40%,color-mix(in_oklch,var(--warning)_25%,transparent)_50%,transparent_60%)] bg-[length:200%_100%]" />
              <TeamAvatar name={t.champion.name} tag={t.champion.tag} size="sm" />
              <div className="relative min-w-0 flex-1">
                <p className="text-[10px] font-semibold tracking-wider text-warning-foreground uppercase dark:text-warning">Champion</p>
                <p className="truncate font-semibold">{t.champion.name}</p>
              </div>
              <Crown className="relative size-5 animate-float text-warning-foreground dark:text-warning" />
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
      </div>

      {/* CTA strip */}
      <div
        className={cn(
          "relative z-10 flex items-center justify-between overflow-hidden border-t px-4 py-3 text-sm font-bold tracking-wide uppercase transition-colors duration-300 sm:px-5",
          "bg-primary/[0.07] text-primary group-hover:bg-primary group-hover:text-primary-foreground",
        )}
      >
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        <span className="relative">{open && !chip ? "View & register" : "Open tournament"}</span>
        <span className="tc-chev relative flex -space-x-2" aria-hidden>
          <ChevronRight className="size-4" />
          <ChevronRight className="size-4" />
          <ChevronRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}

export function TournamentCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="relative flex min-h-[13.5rem] flex-col justify-between bg-gradient-to-b from-muted to-card p-4 sm:min-h-60">
        <div className="h-5 w-28 animate-pulse rounded-full bg-background/70" />
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
      <div className="mx-4 mt-4 h-14 animate-pulse rounded-xl bg-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-1.5 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="h-11 border-t bg-muted/50" />
    </div>
  );
}

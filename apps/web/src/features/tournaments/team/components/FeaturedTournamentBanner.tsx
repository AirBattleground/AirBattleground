import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crown, Layers, Trophy, Users } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { OrganizerBadge } from "@/features/team/components/Branding";
import { CardSegment, HudCorners } from "@/features/team/components/CardSegment";
import { useCardTilt } from "@/features/team/useCardTilt";
import { StatusPill } from "../../shared/StatusPill";
import { fmtPrize, useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { tList } from "@/i18n/tournaments";
import { useTeamTournaments } from "../api";

const ACTIVE = new Set(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"]);

/** The soonest-starting active BR tournament that has a poster; null = no banner (the list below still shows everything). */
export function useFeaturedTournament(): {
  t: TournamentSummary | null;
  loading: boolean;
} {
  const q = useTeamTournaments();
  const t =
    (q.data ?? []).filter((x) => ACTIVE.has(x.status) && !!x.posterUrl && (x.mode ?? "BR") !== "TDM").sort((a, b) => (a.startsAt ?? "￿").localeCompare(b.startsAt ?? "￿"))[0] ??
    null;
  return { t, loading: q.isLoading };
}

/**
 * The poster, blurred and washed into --background, behind the card: it runs edge to edge and up under the
 * see-through header (--shell-top, set by the shell), so the nav picks up the poster's colours. The crisp
 * poster stays in the card. Washes use --background, so light and dark both blend.
 */
function PosterGlow({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-4 top-[calc(-1*var(--shell-top,0px)-1rem)] bottom-[-3rem] -z-10 overflow-hidden sm:-inset-x-5 sm:top-[calc(-1*var(--shell-top,0px)-1.25rem)] lg:-inset-x-6"
    >
      <img
        src={url}
        alt=""
        decoding="async"
        onError={() => setFailed(true)}
        className="size-full scale-110 object-cover object-top opacity-80 blur-2xl saturate-150 dark:opacity-90"
      />
      {/* keep a touch of page colour under the nav so its text stays readable */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/30 to-transparent dark:hidden" />
      {/* sides + bottom: melt into the page */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--background)_0%,transparent_14%,transparent_86%,var(--background)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-background via-background/80 to-transparent" />
    </div>
  );
}

/**
 * Featured hero. Posters carry their own title/prize art, so the poster is shown whole at 25:9
 * (upload ~2500×900, keep text inside the middle 90%) and only fades out at the very bottom;
 * the readable title, specs and the one action sit in the rail underneath.
 */
export function FeaturedTournamentBanner({ t, className }: { t: TournamentSummary; className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const open = t.status === "REGISTRATION_OPEN";
  const live = t.status === "LIVE";
  const showPoster = !!t.posterUrl && !imgFailed;
  const tilt = useCardTilt<HTMLAnchorElement>(0.3);
  const tl = useT(tList);
  const { fmtDay } = useTournamentFormat();

  return (
    <div className={cn("relative", className)}>
      {showPoster && <PosterGlow url={t.posterUrl!} />}
      <Link
        ref={tilt.ref}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        to={`/team/tournaments/${t.id}`}
        data-tour="t-featured"
        data-live={live}
        className={cn(
          "tc-card group relative flex w-full flex-col overflow-hidden rounded-3xl border border-primary/30 bg-card shadow-glow outline-none",
          "hover:border-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          live && "border-destructive/40",
        )}
      >
        {/* poster stage: whole poster, no drift (it would crop the baked-in text), gentle zoom on hover */}
        <div className="ft-stage relative aspect-[25/9] max-h-[26rem] w-full overflow-hidden" aria-hidden>
          {showPoster ? (
            <div className="size-full transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]">
              <img src={t.posterUrl!} alt="" decoding="async" onError={() => setImgFailed(true)} className="size-full object-cover object-[50%_45%]" />
            </div>
          ) : (
            <>
              <div className="tc-aurora absolute -top-20 -left-10 size-72 rounded-full bg-primary/30 blur-3xl" />
              <div className="tc-aurora absolute -top-10 right-0 size-60 rounded-full bg-warning/25 blur-3xl [animation-delay:-6s]" />
              <div className="absolute inset-0 bg-grid opacity-70" />
              <Trophy className="absolute top-1/2 right-[8%] size-40 -translate-y-1/2 rotate-12 text-primary/15 transition-transform duration-700 group-hover:rotate-3 group-hover:scale-110 sm:size-64" />
            </>
          )}
        </div>
        <div className="tc-sheen pointer-events-none absolute inset-0 z-20" aria-hidden />
        <HudCorners />

        {/* the Featured chip sits in the poster's top-left corner (keep that corner clear of text when designing posters) */}
        <div className="absolute top-3 left-3 z-20 flex sm:top-5 sm:left-5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold tracking-[0.2em] text-primary-foreground uppercase shadow-glow">
            <Crown className="size-3.5" /> {tl("featured")}
          </span>
        </div>

        {/* rail: name · prize · organiser ——— specs ——— the one action */}
        <div className="relative z-10 -mt-px grid gap-4 border-t border-primary/15 bg-card px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)_auto] lg:items-center lg:gap-6 lg:px-8">
          <div className="min-w-0">
            <StatusPill status={t.status} className="mb-2" />
            <h2 className="truncate font-display text-2xl leading-tight font-extrabold tracking-tight uppercase transition-colors duration-300 group-hover:text-primary sm:text-3xl">
              {t.title}
            </h2>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              {t.prize && (
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">{tl("prize_pool")}</span>
                  <span className="tc-prize font-display text-xl font-extrabold text-warning-foreground sm:text-2xl dark:text-warning">{fmtPrize(t.prize)}</span>
                </span>
              )}
              <OrganizerBadge
                manager={t.manager}
                className="max-w-full min-w-0 text-xs text-muted-foreground"
                iconClassName="size-3.5 text-primary"
                logoClassName="size-5 rounded-full"
                nameClassName="truncate"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-background/70">
            <CardSegment icon={CalendarDays} label={tl("starts")} value={fmtDay(t.startsAt)} delay={80} />
            <CardSegment icon={Layers} label={tl("stages")} value={t.stagesCount} delay={160} />
            <CardSegment icon={Users} label={tl("teams")} value={`${t.confirmedCount}/${t.maxTeams}`} delay={240} />
          </div>

          {/* arena-btn-gold only styles under the Arena skin; elsewhere this stays the primary button */}
          <div className="arena-btn-gold relative flex h-12 shrink-0 items-center justify-center gap-3 overflow-hidden rounded-xl bg-primary px-8 text-base font-bold tracking-wide text-primary-foreground uppercase shadow-glow sm:h-14">
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative">{open ? tl("register") : live ? tl("watch_live") : tl("open_tournament")}</span>
            <span className="tc-chev relative flex -space-x-2" aria-hidden>
              <ChevronRight className="size-4" />
              <ChevronRight className="size-4" />
              <ChevronRight className="size-4" />
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

export function FeaturedTournamentSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("w-full overflow-hidden rounded-3xl border bg-card", className)}>
      <div className="aspect-[25/9] max-h-[26rem] w-full animate-pulse bg-muted" />
      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)_auto] lg:items-center lg:px-8">
        <div className="space-y-2">
          <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-14 animate-pulse rounded-xl bg-muted" />
        <div className="h-12 w-40 animate-pulse rounded-xl bg-muted sm:h-14" />
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crown, Layers, Trophy, Users } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { OrganizerBadge } from "@/features/team/components/Branding";
import { CardSegment, HudCorners } from "@/features/team/components/CardSegment";
import { useCardTilt } from "@/features/team/useCardTilt";
import { fmtPrize, useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { tList } from "@/i18n/tournaments";
import { useTeamTournaments } from "../api";

const FEATURED_TITLE = /champion'?s?\s+festival/i;
const ACTIVE = new Set(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"]);

/** THE CHAMPION'S FESTIVAL when it exists, otherwise nothing (the normal list below still shows everything). */
export function useFeaturedTournament(): { t: TournamentSummary | null; loading: boolean } {
  const q = useTeamTournaments();
  const t = (q.data ?? []).find((x) => FEATURED_TITLE.test(x.title) && ACTIVE.has(x.status)) ?? null;
  return { t, loading: q.isLoading };
}

export function FeaturedTournamentBanner({ t, className }: { t: TournamentSummary; className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const open = t.status === "REGISTRATION_OPEN";
  const live = t.status === "LIVE";
  const showPoster = !!t.posterUrl && !imgFailed;
  const tilt = useCardTilt<HTMLAnchorElement>(0.4);
  const tl = useT(tList);
  const { fmtDay } = useTournamentFormat();

  return (
    <Link
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      to={`/team/tournaments/${t.id}`}
      data-tour="t-featured"
      data-live={live}
      className={cn(
        "tc-card group relative block w-full overflow-hidden rounded-3xl border border-primary/30 bg-card shadow-glow outline-none",
        "hover:border-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        live && "border-destructive/40",
        className,
      )}
    >
      {/* art: same drift / zoom / scanlines / melt-into-card as the list cards */}
      {showPoster ? (
        <div className="tc-poster pointer-events-none relative h-60 sm:h-80 lg:absolute lg:inset-0 lg:h-auto" aria-hidden>
          <div className="tc-poster-zoom size-full">
            <img src={t.posterUrl!} alt="" decoding="async" onError={() => setImgFailed(true)} className="size-full object-cover object-top" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent lg:bg-gradient-to-r lg:from-card/90 lg:via-card/30 lg:to-transparent" />
          <div className="tc-scan absolute inset-0 opacity-60" />
        </div>
      ) : (
        <div className="tc-poster pointer-events-none relative h-48 overflow-hidden sm:h-64 lg:absolute lg:inset-0 lg:h-auto" aria-hidden>
          <div className="tc-aurora absolute -top-20 -left-10 size-72 rounded-full bg-primary/30 blur-3xl" />
          <div className="tc-aurora absolute -top-10 right-0 size-60 rounded-full bg-warning/25 blur-3xl [animation-delay:-6s]" />
          <div className="absolute inset-0 bg-grid opacity-70" />
          <Trophy className="absolute top-4 right-8 size-64 rotate-12 text-primary/15 transition-transform duration-700 group-hover:rotate-3 group-hover:scale-110" />
        </div>
      )}
      <div className="tc-sheen pointer-events-none absolute inset-0 z-20" aria-hidden />
      <HudCorners />
      <span className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold tracking-[0.2em] text-primary-foreground uppercase shadow-glow sm:top-6 sm:left-6">
        <Crown className="size-3.5" /> {tl("featured")}
      </span>

      <div className="relative z-10 -mt-20 flex flex-col justify-end gap-5 px-4 pt-0 pb-4 sm:-mt-24 sm:gap-6 sm:px-8 sm:pb-8 lg:mt-0 lg:min-h-[26rem] lg:gap-6 lg:p-10">
        {/* name · prize · organiser */}
        <div className="max-w-3xl drop-shadow-[0_1px_8px_var(--card)]">
          <h2 className="font-display text-3xl leading-[1.02] font-extrabold tracking-tight text-balance uppercase transition-colors duration-300 group-hover:text-primary sm:text-5xl lg:text-6xl">{t.title}</h2>
          {t.prize && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2">
              <span className="text-xs font-bold tracking-[0.25em] text-muted-foreground uppercase">{tl("prize_pool")}</span>
              <span className="tc-prize font-display text-2xl font-extrabold text-warning-foreground sm:text-4xl dark:text-warning">{fmtPrize(t.prize)}</span>
            </p>
          )}
          <div className="mt-3 flex">
            <OrganizerBadge
              manager={t.manager}
              className="max-w-full rounded-full border bg-background/70 py-0.5 pr-3 pl-0.5 text-xs font-semibold shadow-sm backdrop-blur-md"
              iconClassName="ml-1.5 size-4 text-primary"
              logoClassName="size-6 rounded-full"
              nameClassName="truncate"
            />
          </div>
        </div>

        {/* info ——— register */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between">
          <div className="grid w-full max-w-2xl grid-cols-3 divide-x overflow-hidden rounded-xl border bg-background/70 backdrop-blur-md">
            <CardSegment icon={CalendarDays} label={tl("starts")} value={fmtDay(t.startsAt)} delay={80} className="sm:px-4 sm:py-3" />
            <CardSegment icon={Layers} label={tl("stages")} value={t.stagesCount} delay={160} className="sm:px-4 sm:py-3" />
            <CardSegment icon={Users} label={tl("teams")} value={`${t.confirmedCount}/${t.maxTeams}`} delay={240} className="sm:px-4 sm:py-3" />
          </div>
          <div
            className={cn(
              "relative flex h-12 shrink-0 items-center justify-center sm:h-14 gap-3 overflow-hidden rounded-xl bg-primary px-8 text-base font-bold tracking-wide text-primary-foreground uppercase shadow-glow lg:h-auto",
            )}
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative">{open ? tl("register") : live ? tl("watch_live") : tl("open_tournament")}</span>
            <span className="tc-chev relative flex -space-x-2" aria-hidden>
              <ChevronRight className="size-4" />
              <ChevronRight className="size-4" />
              <ChevronRight className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function FeaturedTournamentSkeleton({ className }: { className?: string }) {
  return <div className={cn("h-[22rem] w-full animate-pulse rounded-3xl bg-muted lg:h-[26rem]", className)} />;
}

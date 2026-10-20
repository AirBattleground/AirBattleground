import { Link } from "react-router-dom";
import { ChevronRight, MonitorPlay } from "lucide-react";
import type { TeamLiveCard as TeamLiveCardDto } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { useTeamLive } from "../api";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";
import { LiveBadge } from "./HlsPlayer";

const liveViewerHref = (matchId: string) => `/team/live/${matchId}`;

/**
 * Prominent "Watch live" card(s) for the team's matches streaming right now. Renders nothing when none are.
 * `filter` narrows the list (e.g. the tournament hub shows only that tournament's matches).
 */
export function TeamLiveCards({ filter, className }: { filter?: (c: TeamLiveCardDto) => boolean; className?: string }) {
  const t = useT(liveMsg);
  const q = useTeamLive();
  const items = (q.data ?? []).filter((c) => !filter || filter(c));
  if (!items.length) return null;
  return (
    <div className={cn("space-y-3", className)} data-tour="watch-live">
      {items.map((c) => (
        <Link
          key={c.matchId}
          to={liveViewerHref(c.matchId)}
          className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-destructive/40 bg-card p-4 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-destructive/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-4 sm:p-5"
          aria-label={t("watch_live_aria", { title: c.title, n: c.number })}
        >
          <div className="pointer-events-none absolute -top-16 -left-16 size-48 rounded-full bg-destructive/15 blur-3xl" />
          <span className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-sm">
            <MonitorPlay className="size-6" />
            <span className="absolute -top-1 -right-1 size-3 animate-ping rounded-full bg-destructive" aria-hidden />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <LiveBadge startedAt={c.startedAt} />
              <span className="text-xs font-semibold tracking-[0.2em] text-destructive uppercase">{t("your_match_on")}</span>
            </span>
            <span className="mt-1 block truncate font-display text-xl leading-tight font-bold sm:text-2xl">
              {t("title_match", { title: c.title, n: c.number })}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <MapChip map={c.map} className="px-1.5 py-0.5 text-[11px]" />
              {c.subtitle && <span className="truncate">{c.subtitle}</span>}
            </span>
          </span>
          <span className="relative hidden shrink-0 items-center gap-1 rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground sm:inline-flex">
            {t("watch_live")} <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
          <ChevronRight className="relative size-5 shrink-0 text-muted-foreground sm:hidden" />
        </Link>
      ))}
    </div>
  );
}

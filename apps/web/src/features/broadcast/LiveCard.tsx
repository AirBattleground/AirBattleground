import { Link } from "react-router-dom";
import { Play, Radio } from "lucide-react";
import type { LiveBroadcastCard } from "@7xen/shared";
import { LiveBadge } from "@/features/station/components/HlsPlayer";
import { MapChip } from "@/features/team/components/MapChips";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";

/** One live broadcast: organiser art, LIVE timer, title, map and a Watch button. */
export function LiveCard({ b, to }: { b: LiveBroadcastCard; to: string }) {
  const t = useT(liveMsg);
  return (
    <Link
      to={to}
      aria-label={t("watch_live_aria", { title: b.title, n: b.number })}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-destructive/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative aspect-video overflow-hidden bg-muted bg-[radial-gradient(ellipse_at_30%_20%,color-mix(in_oklch,var(--destructive)_22%,transparent),transparent_70%)]">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 flex items-center justify-center">
          {b.organizer.logoUrl ? (
            <img src={b.organizer.logoUrl} alt="" className="size-20 rounded-2xl bg-background object-contain p-2 shadow-lg" loading="lazy" />
          ) : (
            <Radio className="size-12 text-destructive/70" />
          )}
        </div>
        <LiveBadge startedAt={b.startedAt} className="absolute top-3 left-3" />
        <span className="absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform group-hover:scale-110">
          <Play className="size-5 fill-current" />
        </span>
      </div>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg leading-tight font-bold">{t("title_match", { title: b.title, n: b.number })}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {b.organizer.name}
            {b.subtitle ? ` · ${b.subtitle}` : ""}
          </p>
        </div>
        <MapChip map={b.map} className="shrink-0" />
      </div>
    </Link>
  );
}

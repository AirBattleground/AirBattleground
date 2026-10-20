import { Link } from "react-router-dom";
import { Play, Radio } from "lucide-react";
import type { LiveBroadcastCard } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { LiveBadge } from "@/features/station/components/HlsPlayer";
import { MapChip } from "@/features/team/components/MapChips";

/** One live broadcast: organiser art, LIVE timer, title, map and a Watch button. */
export function LiveCard({ b, to }: { b: LiveBroadcastCard; to: string }) {
  return (
    <Link to={to} className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-destructive/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <div className="relative aspect-video overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#3d2a2a_0%,#1d1414_45%,#0b0808_100%)]">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 flex items-center justify-center">
          {b.organizer.logoUrl ? (
            <img src={b.organizer.logoUrl} alt="" className="size-24 rounded-2xl bg-white/95 object-contain p-2 shadow-lg" loading="lazy" />
          ) : (
            <Radio className="size-14 text-destructive/70" />
          )}
        </div>
        <LiveBadge startedAt={b.startedAt} className="absolute top-3 left-3" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-14 items-center justify-center rounded-full bg-background/85 shadow-lg backdrop-blur">
            <Play className="size-6 fill-current" />
          </span>
        </span>
      </div>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg leading-tight font-bold">
            {b.title} · Match {b.number}
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {b.organizer.name} · {b.subtitle}
          </p>
        </div>
        <MapChip map={b.map} className="shrink-0" />
      </div>
      <div className="px-4 pb-4">
        <Button asChild className="w-full" tabIndex={-1}>
          <span>
            <Play /> Watch live
          </span>
        </Button>
      </div>
    </Link>
  );
}

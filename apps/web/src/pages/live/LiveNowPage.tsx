import { Link, useLocation } from "react-router-dom";
import { Play, Radio } from "lucide-react";
import type { LiveBroadcastCard } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { LiveBadge } from "@/features/station/components/HlsPlayer";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";

const TOUR: TourStep[] = [
  { title: "Live now", description: "Every match an organiser is broadcasting right now. Anyone can watch — even without signing in." },
  { element: '[data-tour="live-grid"]', title: "Pick a match", description: "Tap a match to watch it. You can pause and go back to anything since you started watching, then jump to Live again.", side: "top" },
];

/** Live page for players (/team/live) and managers (/manager/live): every broadcast on right now. */
export default function LiveNowPage() {
  usePageTour("live.now", TOUR);
  const base = useLocation().pathname.startsWith("/manager") ? "/manager" : "/team";
  const q = useLiveBroadcasts();
  const items = q.data ?? [];

  return (
    <>
      <PageHeader eyebrow="Streams" title={<>Live <span className="text-gradient-brand">now</span></>} description="Matches being broadcast right now. Tap one to watch." />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load live matches" />
      ) : q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Radio />} title="Nothing live right now" description="When an organiser starts a broadcast it shows up here, and a red Live count appears in the menu." />
      ) : (
        <div data-tour="live-grid" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <LiveCard key={b.matchId} b={b} to={`${base}/live/${b.matchId}`} />
          ))}
        </div>
      )}
    </>
  );
}

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

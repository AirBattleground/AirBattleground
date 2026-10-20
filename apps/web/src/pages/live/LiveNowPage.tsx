import { useLocation } from "react-router-dom";
import { Radio } from "lucide-react";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { LiveCard } from "@/features/broadcast/LiveCard";
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

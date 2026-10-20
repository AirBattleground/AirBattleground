import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Radio } from "lucide-react";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { LiveCard } from "@/features/broadcast/LiveCard";
import { QueryError } from "@/features/team/components/QueryError";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";

/** Live page for players (/team/live) and managers (/manager/live): every broadcast on right now. */
export default function LiveNowPage() {
  const t = useT(liveMsg);
  const tour = useMemo<TourStep[]>(
    () => [
      { title: t("now_tour_title"), description: t("now_tour_desc") },
      { element: '[data-tour="live-grid"]', title: t("now_tour_grid_title"), description: t("now_tour_grid_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("live.now", tour);
  const base = useLocation().pathname.startsWith("/manager") ? "/manager" : "/team";
  const q = useLiveBroadcasts();
  const items = q.data ?? [];

  return (
    <>
      <PageHeader eyebrow={t("streams")} title={t.rich("now_heading", { g: (c) => <span className="text-gradient-brand">{c}</span> })} description={t("now_desc")} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_list_error")} />
      ) : q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Radio />} title={t("nothing_live")} description={t("nothing_live_desc")} />
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

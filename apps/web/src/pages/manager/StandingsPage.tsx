import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate, formatTime } from "@/features/manager/format";
import { QueryError } from "@/features/manager/components/QueryError";
import { useManagerStandings } from "@/features/results/api";
import { PointsSystemDialog } from "@/features/results/components/PointsSystemDialog";
import { PointsLegend, StandingsBoard, StandingsSkeleton, StandingsSummary } from "@/features/results/components/Standings";

const TOUR: TourStep[] = [
  { title: "Points table", description: "The overall ranking of this session, updated every time you publish a match." },
  { element: '[data-tour="standings-table"]', title: "Rankings", description: "Points per match, chicken dinners, finishes and the total. Click a match header to open that match." },
  { element: '[data-tour="standings-copy"]', title: "Share it", description: "Copy the table as text and paste it into WhatsApp or Discord." },
  { element: '[data-tour="points-legend"]', title: "How points work", description: "Placement points plus points per finish. You can change the system for this scrim here." },
];

export default function StandingsPage() {
  usePageTour("manager.standings", TOUR);
  const { scrimId = "", date = "" } = useParams();
  const q = useManagerStandings(scrimId, date);
  const [editing, setEditing] = useState(false);
  const s = q.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={`/manager/scrims/${scrimId}?date=${date}&tab=matches`}>
          <ArrowLeft /> Back to session
        </Link>
      </Button>
      <PageHeader
        eyebrow={s ? `${formatDate(s.date)} · ${formatTime(s.scrim.startTime)} IST` : "Points table"}
        title={s ? s.scrim.title : "Points table"}
        description="Overall ranking for this session. Only published matches count."
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load the points table" />
      ) : !s ? (
        <StandingsSkeleton />
      ) : (
        <div className="space-y-4">
          <StandingsSummary standings={s} />
          <StandingsBoard standings={s} matchHref={(m) => `/manager/scrims/${scrimId}/${date}/matches/${m.id}`} />
          <PointsLegend
            ps={s.pointsSystem}
            action={
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Settings2 /> Change points system
              </Button>
            }
          />
          <PointsSystemDialog open={editing} onOpenChange={setEditing} scrimId={scrimId} value={s.pointsSystem} />
        </div>
      )}
    </>
  );
}

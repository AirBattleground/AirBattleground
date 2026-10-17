import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Home, MonitorOff, Trophy } from "lucide-react";
import type { TeamLiveCard } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { liveHlsUrl, useTeamLive } from "@/features/station/api";
import { HlsPlayer, type PlayerState } from "@/features/station/components/HlsPlayer";

const STEPS: TourStep[] = [
  { title: "Watching live", description: "This is your match, streamed live from the organiser's 7XEN Station." },
  { element: '[data-tour="live-player"]', title: "The live picture", description: "It runs about 5–10 seconds behind the game. Tap the speaker for sound, or the corner button for full screen.", side: "bottom" },
  { element: '[data-tour="live-note"]', title: "After the match", description: "When the stream ends, the results show up in Results once the organiser publishes them.", side: "top" },
];

const ENDED = "The match stream has ended — results will appear once the organiser publishes them.";

function Back() {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/team">
        <ArrowLeft /> Home
      </Link>
    </Button>
  );
}

function EndedActions() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button asChild>
        <Link to="/team/results">
          <Trophy /> Go to results
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/team">
          <Home /> Home
        </Link>
      </Button>
    </div>
  );
}

export default function LiveViewerPage() {
  usePageTour("team.live", STEPS);
  const { matchId = "" } = useParams();
  const q = useTeamLive();
  const card = q.data?.find((c) => c.matchId === matchId);
  // keep the title/map on screen after the match drops out of the live list
  const [seen, setSeen] = useState<TeamLiveCard | null>(null);
  if (card && card !== seen && (seen?.matchId !== card.matchId || seen.startedAt !== card.startedAt || seen.hlsUrl !== card.hlsUrl)) setSeen(card);
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");

  const shown = card ?? seen;
  const ended = (!!seen && q.isSuccess && !card) || playerState === "ended";

  if (q.isError && !shown)
    return (
      <>
        <Back />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the live stream" />
      </>
    );

  if (q.isPending)
    return (
      <>
        <Back />
        <Skeleton className="mb-4 h-12 w-72" />
        <Skeleton className="aspect-video w-full rounded-xl" />
      </>
    );

  if (!shown)
    return (
      <>
        <Back />
        <EmptyState
          icon={<MonitorOff />}
          title="This match isn't live right now"
          description="The stream may not have started yet, or it has already ended — results appear once the organiser publishes them. Live matches show up on your home screen."
          action={<EndedActions />}
        />
      </>
    );

  return (
    <>
      <Back />
      <PageHeader
        eyebrow={ended ? "Stream ended" : "Watching live"}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0">
              {shown.title} · Match {shown.number}
            </span>
            <MapChip map={shown.map} className="text-sm" />
          </span>
        }
        description={shown.subtitle || undefined}
      />
      <div className="space-y-3">
        <div data-tour="live-player" className="-mx-4 sm:mx-0">
          <HlsPlayer
            src={shown.hlsUrl || liveHlsUrl(shown.matchId)}
            startedAt={shown.startedAt}
            ended={ended}
            onStateChange={setPlayerState}
            frameClassName="rounded-none border-x-0 sm:rounded-xl sm:border-x"
            endedSlot={
              <div className="max-w-md space-y-3 rounded-xl border bg-card/95 p-4 text-center shadow-sm backdrop-blur-sm sm:p-5">
                <MonitorOff className="mx-auto size-7 text-muted-foreground" />
                <p className="text-sm font-medium">{ENDED}</p>
                <EndedActions />
              </div>
            }
          />
        </div>
        <p data-tour="live-note" className="text-xs text-muted-foreground">
          {ended ? "Results show up in Results once the organiser publishes them." : "The stream runs about 5–10 seconds behind the game. Results appear in Results once the organiser publishes them."}
        </p>
      </div>
    </>
  );
}

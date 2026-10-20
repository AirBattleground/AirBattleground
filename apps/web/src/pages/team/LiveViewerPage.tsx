import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
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
import { LiveOverlay } from "@/features/broadcast/LiveOverlay";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";
import { common } from "@/i18n/common";

/** Players watch under /team, managers under /manager (same page). */
function useArea() {
  return useLocation().pathname.startsWith("/manager") ? ("manager" as const) : ("team" as const);
}

function Back() {
  const area = useArea();
  const t = useT(liveMsg);
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={`/${area}/live`}>
        <ArrowLeft /> {t("live_now")}
      </Link>
    </Button>
  );
}

function EndedActions() {
  const area = useArea();
  const t = useT(liveMsg);
  const c = useT(common);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {area === "team" && (
        <Button asChild>
          <Link to="/team/results">
            <Trophy /> {t("go_results")}
          </Link>
        </Button>
      )}
      <Button asChild variant="outline">
        <Link to={`/${area}`}>
          <Home /> {c("nav_home")}
        </Link>
      </Button>
    </div>
  );
}

export default function LiveViewerPage() {
  const t = useT(liveMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("v_tour_title"), description: t("v_tour_desc") },
      { element: '[data-tour="live-player"]', title: t("v_tour_player_title"), description: t("v_tour_player_desc"), side: "bottom" },
      { element: '[data-tour="live-note"]', title: t("v_tour_note_title"), description: t("v_tour_note_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.live", steps);
  const { matchId = "" } = useParams();
  const area = useArea();
  // the player's own matches (station or iPhone) + every iPhone broadcast (open to anyone signed in)
  const teamQ = useTeamLive({ enabled: area === "team" });
  const pub = useLiveBroadcasts();
  const card: TeamLiveCard | undefined = teamQ.data?.find((c) => c.matchId === matchId) ?? pub.data?.find((c) => c.matchId === matchId);
  const team = area === "team";
  // one status for both lists: loaded = every list we asked for answered
  const q = {
    isPending: !card && (pub.isPending || (team && teamQ.isPending)),
    isError: pub.isError && (!team || teamQ.isError),
    isSuccess: pub.isSuccess && (!team || !teamQ.isPending),
    error: pub.error ?? teamQ.error,
    refetch: () => {
      void pub.refetch();
      if (team) void teamQ.refetch();
    },
  };
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
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_stream_error")} />
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
          title={t("not_live_title")}
          description={t("not_live_desc")}
          action={<EndedActions />}
        />
      </>
    );

  return (
    <>
      <Back />
      <PageHeader
        eyebrow={ended ? t("stream_ended") : t("watching_live")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0">{t("title_match", { title: shown.title, n: shown.number })}</span>
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
            showLiveBadge={!shown.overlayUrl}
            dvr={!!shown.overlayUrl}
            frameClassName="rounded-none border-x-0 sm:rounded-xl sm:border-x"
            endedSlot={
              <div className="max-w-md space-y-3 rounded-xl border bg-card/95 p-4 text-center shadow-sm backdrop-blur-sm sm:p-5">
                <MonitorOff className="mx-auto size-7 text-muted-foreground" />
                <p className="text-sm font-medium">{t("ended_long")}</p>
                <EndedActions />
              </div>
            }
          >
            {shown.overlayUrl && !ended && <LiveOverlay url={shown.overlayUrl} />}
          </HlsPlayer>
        </div>
        <p data-tour="live-note" className="text-xs text-muted-foreground">
          {ended ? t("note_ended") : t("note_live")}
        </p>
      </div>
    </>
  );
}

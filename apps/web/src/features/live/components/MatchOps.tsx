import { Link } from "react-router-dom";
import { Clapperboard, Radio } from "lucide-react";
import { MAP_LABELS } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import type { TourStep } from "@7xen/ui/tour";
import { RecordingsCard, LiveBanner } from "./RecordingsCard";
import { RoomCard, type MatchLabel } from "./RoomCard";
import { STATION_TOUR, StationPanel } from "@/features/station/components/StationPanel";

/** Tour steps for the match-day cards — append to a match center tour. */
export const MATCH_OPS_TOUR: TourStep[] = [
  { element: '[data-tour="match-studio"]', title: "Stream it from Studio", description: "Phones, broadcast and team-list / results screenshots for this match all live in the Studio now.", side: "bottom" },
  ...STATION_TOUR,
  { element: '[data-tour="room-card"]', title: "Room ID & password", description: "Create the room in BGMI on the station, then add the ID and password here. Teams see them at the time you choose.", side: "bottom" },
  { element: '[data-tour="room-whatsapp"]', title: "Share in one tap", description: "Copies a ready-made message with the room ID and password for your WhatsApp group.", side: "top" },
  { element: '[data-tour="recordings-card"]', title: "Match recordings", description: "Every game the station records is saved here when you stop. Click one to play it.", side: "bottom" },
];

/** The Studio is where a match is streamed and captured: one small card that opens it for this match. */
function StudioCard({ matchId, label }: { matchId: string; label: MatchLabel }) {
  const title = `${label.title} · Match ${label.number}`;
  return (
    <div data-tour="match-studio" className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Clapperboard className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Stream & capture in Studio</p>
        <p className="text-sm text-muted-foreground">Broadcast this match from your phones and grab the team list or results from the stream.</p>
      </div>
      <Button asChild size="lg">
        <Link to={`/manager/studio?match=${encodeURIComponent(matchId)}&title=${encodeURIComponent(title)}`}>
          <Radio /> Open Studio
        </Link>
      </Button>
    </div>
  );
}

/** Studio link + station + room + recordings for one match (scrim or tournament match center). */
export function MatchOps({ matchId, label, readOnly }: { matchId: string; label: MatchLabel; readOnly?: boolean }) {
  return (
    <div className="space-y-3">
      {!readOnly && <StudioCard matchId={matchId} label={label} />}
      {!readOnly && <StationPanel matchId={matchId} />}
      <LiveBanner matchId={matchId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RoomCard matchId={matchId} label={label} readOnly={readOnly} />
        <RecordingsCard matchId={matchId} title={`${label.title} · Match ${label.number} · ${MAP_LABELS[label.map]}`} />
      </div>
    </div>
  );
}

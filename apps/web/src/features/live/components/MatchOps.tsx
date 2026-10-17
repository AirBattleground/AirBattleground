import { MAP_LABELS } from "@7xen/shared";
import type { TourStep } from "@7xen/ui/tour";
import { RecordingsCard, LiveBanner } from "./RecordingsCard";
import { RoomCard, type MatchLabel } from "./RoomCard";

/** Tour steps for the match-day cards — append to a match center tour. */
export const MATCH_OPS_TOUR: TourStep[] = [
  { element: '[data-tour="room-card"]', title: "Room ID & password", description: "The 7XEN Manager app fills these in when it creates the room — or add them yourself. Teams see them at the time you choose.", side: "bottom" },
  { element: '[data-tour="room-whatsapp"]', title: "Share in one tap", description: "Copies a ready-made message with the room ID and password for your WhatsApp group.", side: "top" },
  { element: '[data-tour="recordings-card"]', title: "Match recordings", description: "Every game the app records shows here — live, uploading, then ready to watch. Click one to play it.", side: "bottom" },
];

/** Room + recordings for one match (scrim or tournament match center). */
export function MatchOps({ matchId, label, readOnly }: { matchId: string; label: MatchLabel; readOnly?: boolean }) {
  return (
    <div className="space-y-3">
      <LiveBanner matchId={matchId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RoomCard matchId={matchId} label={label} readOnly={readOnly} />
        <RecordingsCard matchId={matchId} title={`${label.title} · Match ${label.number} · ${MAP_LABELS[label.map]}`} />
      </div>
    </div>
  );
}

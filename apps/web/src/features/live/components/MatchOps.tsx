import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Clapperboard, DoorOpen, MessageCircle, Video } from "lucide-react";
import { MAP_LABELS } from "@7xen/shared";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@7xen/ui/components/ui/sheet";
import type { TourStep } from "@7xen/ui/tour";
import { cn } from "@7xen/ui/lib/utils";
import { useNow } from "@/features/manager/components/useNow";
import { useRecordings, useRoom } from "../api";
import { CopyButton } from "./CopyButton";
import { RecordingsCard, LiveBanner } from "./RecordingsCard";
import { RoomCard, roomMessage, type MatchLabel } from "./RoomCard";

/** Tour steps for the match kit strip — append to a match center tour. */
export const MATCH_OPS_TOUR: TourStep[] = [
  { element: '[data-tour="match-kit"]', title: "Everything for this match", description: "Room, Studio and recordings sit in this one strip. Tap a tile to open it.", side: "bottom" },
  { element: '[data-tour="kit-room"]', title: "Room ID & password", description: "Add them here. Teams see them at the time you choose. Copy sends a ready-made WhatsApp message.", side: "bottom" },
  { element: '[data-tour="match-studio"]', title: "Stream it from Studio", description: "Broadcast this match and grab the team list or results screenshots from the stream.", side: "bottom" },
];

type Panel = "room" | "recordings" | null;

/** One tile of the strip: icon, label, a short status line, optional quick action. */
function Tile({
  icon,
  label,
  value,
  tone,
  onOpen,
  to,
  action,
  tour,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: "live" | "ok" | "muted";
  onOpen?: () => void;
  to?: string;
  action?: ReactNode;
  tour: string;
}) {
  const body = (
    <>
      <span
        className={cn(
          "hidden size-9 shrink-0 items-center sm:flex justify-center rounded-lg",
          tone === "live" ? "bg-destructive/15 text-destructive" : tone === "ok" ? "bg-success/15 text-success" : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className={cn("block truncate text-sm font-semibold", tone === "muted" && "font-normal text-muted-foreground")}>{value}</span>
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 sm:gap-3 sm:p-1 transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <div data-tour={tour} className="flex min-w-0 items-center gap-1 bg-card p-1.5 sm:gap-2 sm:p-3">
      {to ? (
        <Link to={to} className={cls}>
          {body}
          <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={cls}>
          {body}
          <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
        </button>
      )}
      {action}
    </div>
  );
}

/**
 * Room, Studio and recordings for one match, in one compact strip (scrim or tournament match center).
 * Details open in a side sheet so the match steps stay at the top of the page. Streaming happens in the Studio.
 */
export function MatchOps({ matchId, label, readOnly }: { matchId: string; label: MatchLabel; readOnly?: boolean }) {
  const [panel, setPanel] = useState<Panel>(null);
  const room = useRoom(matchId).data ?? null;
  const recs = (useRecordings(matchId).data ?? []).filter((r) => r.status !== "DELETED");
  const now = useNow(30_000);

  const roomVisible = !!room && (!room.revealAt || new Date(room.revealAt).getTime() <= now);
  const recLive = recs.some((r) => r.status === "LIVE");
  const title = `${label.title} · Match ${label.number}`;

  return (
    <div className="space-y-3">
      <LiveBanner matchId={matchId} />
      <div data-tour="match-kit" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm lg:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
        <Tile
          tour="kit-room"
          icon={<DoorOpen className="size-4" />}
          label="Room"
          tone={room ? (roomVisible ? "ok" : undefined) : "muted"}
          value={room ? `${room.roomId} · ${roomVisible ? "teams can see it" : "hidden for now"}` : readOnly ? "No room" : "Add room ID & password"}
          onOpen={() => setPanel("room")}
          action={
            room && !readOnly ? (
              <CopyButton value={roomMessage(label, room)} label="Copy WhatsApp message" toastText="Copied — paste it in your WhatsApp group">
                <MessageCircle /> <span className="hidden sm:inline">Copy</span>
              </CopyButton>
            ) : undefined
          }
        />
        {!readOnly && (
          <Tile
            tour="match-studio"
            icon={<Clapperboard className="size-4" />}
            label="Studio"
            value="Stream & capture screenshots"
            to={`/manager/studio?match=${encodeURIComponent(matchId)}&title=${encodeURIComponent(title)}`}
          />
        )}
        <Tile
          tour="kit-recordings"
          icon={<Video className="size-4" />}
          label="Recordings"
          tone={recLive ? "live" : recs.length ? undefined : "muted"}
          value={recLive ? "Recording now" : recs.length ? `${recs.length} saved` : "None yet"}
          onOpen={() => setPanel("recordings")}
        />
      </div>

      <Sheet open={panel != null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{panel === "room" ? "Room" : "Recordings"}</SheetTitle>
            <SheetDescription>{title}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {panel === "room" && <RoomCard matchId={matchId} label={label} readOnly={readOnly} />}
            {panel === "recordings" && <RecordingsCard matchId={matchId} title={`${title} · ${MAP_LABELS[label.map]}`} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

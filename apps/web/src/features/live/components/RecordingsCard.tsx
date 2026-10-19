import { useState } from "react";
import { Download, Film, Play, Smartphone, Video } from "lucide-react";
import type { RecordingRow } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { recordingPosterUrl, recordingVideoUrl, useRecordings } from "../api";
import { fmtBytes } from "../format";
import { recordingFacts, RecordingStatusPill, uploadPct, VideoDialog } from "./RecordingParts";

function Poster({ r }: { r: RecordingRow }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-lg border bg-muted sm:w-36">
      {r.hasPoster && !broken ? (
        <img src={recordingPosterUrl(r.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Film className="size-6" />
        </span>
      )}
      {r.status === "READY" && (
        <span className="absolute inset-0 grid place-items-center bg-background/0 transition-colors group-hover:bg-background/40">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform group-hover:scale-110">
            <Play className="size-4 fill-current" />
          </span>
        </span>
      )}
      {r.status === "LIVE" && <span className="absolute top-1.5 left-1.5 size-2.5 animate-pulse rounded-full bg-destructive ring-2 ring-card" aria-hidden />}
    </span>
  );
}

function RecordingItem({ r, onPlay }: { r: RecordingRow; onPlay: () => void }) {
  const ready = r.status === "READY";
  const pct = uploadPct(r);
  const body = (
    <>
      <Poster r={r} />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <RecordingStatusPill status={r.status} />
          {(r.captures.slotList > 0 || r.captures.results > 0) && (
            <span className="text-xs text-muted-foreground">
              {r.captures.slotList} team list · {r.captures.results} results shots
            </span>
          )}
        </span>
        <span className="block truncate text-sm font-medium">{recordingFacts(r)}</span>
        {r.status === "UPLOADING" && (
          <span className="block space-y-1">
            <Progress value={pct} className="h-1.5" aria-label="Upload progress" />
            <span className="block text-xs text-muted-foreground">
              {pct}% · {fmtBytes(r.uploadedBytes)} of {fmtBytes(r.sizeBytes)} — uploads from the phone in the background
            </span>
          </span>
        )}
        {r.status === "STOPPED" && <span className="block text-xs text-muted-foreground">The phone uploads it on Wi-Fi.</span>}
        {r.status === "PROCESSING" && <span className="block text-xs text-muted-foreground">Uploaded — preparing the video. Ready in a minute.</span>}
        {r.status === "FAILED" && r.error && <span className="line-clamp-2 block text-xs text-destructive">{r.error}</span>}
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2">
      {ready ? (
        <button
          type="button"
          onClick={onPlay}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Play recording · ${recordingFacts(r)}`}
        >
          {body}
        </button>
      ) : (
        <div className="group flex min-w-0 flex-1 items-center gap-3 p-1.5">{body}</div>
      )}
      {ready && (
        <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="Download video" title="Download">
          <a href={recordingVideoUrl(r.id)} download>
            <Download />
          </a>
        </Button>
      )}
    </li>
  );
}

/** Live banner: shown above the match center while the phone app is recording this match. */
export function LiveBanner({ matchId }: { matchId: string }) {
  const q = useRecordings(matchId);
  // the AirBattleground Station has its own panel above, so only phone recordings get this banner
  const live = q.data?.find((r) => r.status === "LIVE" && r.deviceName !== "7XEN Station");
  if (!live) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 sm:p-4" data-tour="live-banner">
      <span className="relative flex size-3 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-destructive" />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-display text-base font-bold">Recording on {live.deviceName ?? "the manager's phone"}</span>
        <span className="block text-muted-foreground">Screenshots the app captures show up below automatically.</span>
      </p>
      <Smartphone className="hidden size-5 shrink-0 text-destructive sm:block" />
    </div>
  );
}

/** Every recording of a match (AirBattleground Station or phone), with upload progress and a player. */
export function RecordingsCard({ matchId, title }: { matchId: string; title: string }) {
  const q = useRecordings(matchId);
  const [playing, setPlaying] = useState<RecordingRow | null>(null);
  const items = (q.data ?? []).filter((r) => r.status !== "DELETED");

  return (
    <section data-tour="recordings-card" aria-labelledby="rec-card-title" className="relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("flex size-9 items-center justify-center rounded-lg", items.some((r) => r.status === "LIVE") ? "bg-destructive/10 text-destructive" : "bg-primary/15 text-primary")}>
          <Video className="size-5" />
        </span>
        <h2 id="rec-card-title" className="font-display text-xl font-bold">
          Recordings
        </h2>
        {items.length > 0 && <span className="text-sm text-muted-foreground">{items.length}</span>}
      </div>
      {q.isPending ? (
        <div className="flex items-center gap-3">
          <Skeleton className="aspect-video w-28 rounded-lg sm:w-36" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recordings yet. Press <span className="font-semibold text-foreground">Prepare</span> above — the station opens BGMI, records the whole game and saves it
          here when you stop.
        </p>
      ) : (
        <ul className="-m-1.5 space-y-1">
          {items.map((r) => (
            <RecordingItem key={r.id} r={r} onPlay={() => setPlaying(r)} />
          ))}
        </ul>
      )}
      <VideoDialog
        open={!!playing}
        onOpenChange={(o) => !o && setPlaying(null)}
        title={title}
        subtitle={playing ? recordingFacts(playing) : undefined}
        src={playing ? recordingVideoUrl(playing.id) : ""}
        poster={playing?.hasPoster ? recordingPosterUrl(playing.id) : undefined}
      />
    </section>
  );
}

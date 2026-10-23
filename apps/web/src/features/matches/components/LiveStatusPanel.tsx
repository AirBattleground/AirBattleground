import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Camera, ImageIcon, Radio } from "lucide-react";
import { LIVE_PLAYER_STATES, type LiveAutoCapture, type LivePlayerState, type StudioLinkLiveTeam } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { cn } from "@7xen/ui/lib/utils";
import { QueryError } from "@/features/manager/components/QueryError";
import { useNow } from "@/features/manager/components/useNow";
import { useLiveStatus, useSaveLiveTeam, useSetAutoPaused } from "../api";

const pad = (n: number) => String(n).padStart(2, "0");
const next = (s: LivePlayerState): LivePlayerState => LIVE_PLAYER_STATES[(LIVE_PLAYER_STATES.indexOf(s) + 1) % LIVE_PLAYER_STATES.length]!;
const LABEL: Record<LivePlayerState, string> = { alive: "Alive", knocked: "Knocked", eliminated: "Out" };
const TONE: Record<LivePlayerState, string> = {
  alive: "border-warning/50 bg-warning/15 text-foreground",
  knocked: "border-destructive/50 bg-destructive/15 text-destructive",
  eliminated: "border-border bg-muted text-muted-foreground line-through",
};

/** Match Center, while the match is live: tap a player to cycle alive → knocked → out. Feeds the studio's Team Status board. */
export function LiveStatusPanel({ matchId }: { matchId: string }) {
  const q = useLiveStatus(matchId);
  const save = useSaveLiveTeam(matchId);

  const tap = (t: StudioLinkLiveTeam, i: number) =>
    save.mutate({ teamId: t.id, players: t.players.map((p, j) => (j === i ? next(p.state) : p.state)) });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" data-tour="live-status">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
          <Radio className="size-5" />
        </span>
        <div>
          <h3 className="font-display text-lg font-bold">Who's still in?</h3>
          <p className="text-sm text-muted-foreground">Tap a player when they're knocked, tap again when they're out. Your stream's Team Status board updates within a few seconds.</p>
        </div>
      </div>

      {q.data?.autoCapture && <AutoCaptureBar matchId={matchId} auto={q.data.autoCapture} />}

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load the live status" />
      ) : !q.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : q.data.teams.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No teams are registered on this match yet.</p>
      ) : (
        <ul className="divide-y">
          {q.data.teams.map((t) => (
            <li key={t.id} className={cn("flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-4", t.status === 0 && "opacity-50")}>
              <div className="flex min-w-0 items-center gap-3 sm:w-56">
                <span className="font-display text-lg font-bold text-primary">#{pad(t.slot)}</span>
                <span className="truncate font-semibold">{t.name}</span>
                <span className="ml-auto shrink-0 font-display text-sm text-muted-foreground sm:ml-0">{t.status === 0 ? "Out" : `${t.status} alive`}</span>
              </div>
              <div className="grid flex-1 grid-cols-4 gap-2">
                {t.players.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => tap(t, i)}
                    title={`${p.name ?? `Player ${i + 1}`}: ${LABEL[p.state]}${p.source ? ` (set by ${p.source === "auto" ? "auto capture" : "you"})` : ""} — tap to change`}
                    className={cn(
                      "relative min-w-0 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                      TONE[p.state],
                    )}
                  >
                    <span className="block truncate text-sm font-semibold">{p.name ?? `Player ${i + 1}`}</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80">
                      {LABEL[p.state]}
                      {p.source && (
                        <span className="rounded bg-background/60 px-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground no-underline">
                          {p.source}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Auto capture from 7XEN Studio: live / last capture / last error, the reader's latest image, and the pause switch. */
function AutoCaptureBar({ matchId, auto }: { matchId: string; auto: LiveAutoCapture }) {
  useNow(5_000); // re-render so "x seconds ago" stays current
  const pause = useSetAutoPaused(matchId);
  const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <Camera className={cn("size-4 shrink-0", auto.active && !auto.paused ? "text-success" : "text-muted-foreground")} />
        <div className="min-w-0">
          <p className="font-semibold">
            Auto capture{" "}
            <span className={cn("font-normal", auto.active && !auto.paused ? "text-success" : "text-muted-foreground")}>
              {auto.paused ? "· paused" : auto.active ? "· on" : "· off"}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {auto.lastCaptureAt ? `Last capture ${ago(auto.lastCaptureAt)}` : "Turn on Auto capture on a scene in 7XEN Studio to fill this in for you."}
            {auto.lastAppliedAt && ` · last read ${ago(auto.lastAppliedAt)}`}
          </p>
          {auto.lastError && <p className="text-xs text-destructive">{auto.lastError}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {auto.latestImageUrl && (
          <a href={auto.latestImageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <ImageIcon className="size-3.5" /> Latest capture
          </a>
        )}
        <label className="flex items-center gap-2 text-xs font-medium">
          <Switch checked={auto.paused} disabled={pause.isPending} onCheckedChange={(paused) => pause.mutate({ paused })} />
          Pause auto updates
        </label>
      </div>
    </div>
  );
}

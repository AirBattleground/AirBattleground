import { Radio } from "lucide-react";
import { LIVE_PLAYER_STATES, type LivePlayerState, type StudioLinkLiveTeam } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { QueryError } from "@/features/manager/components/QueryError";
import { useLiveStatus, useSaveLiveTeam } from "../api";

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
                    title={`${p.name ?? `Player ${i + 1}`}: ${LABEL[p.state]} — tap to change`}
                    className={cn(
                      "min-w-0 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                      TONE[p.state],
                    )}
                  >
                    <span className="block truncate text-sm font-semibold">{p.name ?? `Player ${i + 1}`}</span>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider opacity-80">{LABEL[p.state]}</span>
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

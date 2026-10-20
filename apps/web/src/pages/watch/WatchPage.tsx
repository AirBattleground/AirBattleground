import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, LogIn, MonitorOff, Radio } from "lucide-react";
import { toast } from "sonner";
import type { LiveBroadcastCard } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { LiveOverlay } from "@/features/broadcast/LiveOverlay";
import { HlsPlayer, type PlayerState } from "@/features/station/components/HlsPlayer";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { LiveCard } from "@/features/broadcast/LiveCard";
import markUrl from "@/assets/brand/airbattleground-mark.webp";

/** Public link to a match's broadcast (shared from the match center). */
export const watchUrl = (matchId: string) => `${window.location.origin}/watch/${matchId}`;

/** Public shell: brand, theme, and a way into the portal. No sign-in needed. */
function PublicShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/watch" className="flex items-center gap-2 font-display text-lg font-bold">
            <img src={markUrl} alt="" className="size-8" />
            AirBattleground
            <span className="ml-1 hidden items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive sm:inline-flex">
              <Radio className="size-3" /> Live
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm" variant={user ? "outline" : "default"}>
              <Link to={user ? "/" : "/login"}>{user ? "Open my portal" : <><LogIn /> Log in</>}</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

/** /watch (every live match) and /watch/:matchId (one match) — open to everyone. */
export default function WatchPage() {
  const { matchId } = useParams();
  return <PublicShell>{matchId ? <WatchOne matchId={matchId} /> : <WatchList />}</PublicShell>;
}

function WatchList() {
  const q = useLiveBroadcasts();
  const items = q.data ?? [];
  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-bold tracking-[0.25em] text-destructive uppercase">Live now</p>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Watch BGMI matches live</h1>
        <p className="mt-1 text-muted-foreground">Scrims and tournaments being broadcast by organisers right now. Tap one to watch — no sign-in needed.</p>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load live matches" />
      ) : q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Radio />} title="Nothing live right now" description="When an organiser starts a broadcast, the match shows up here. This page refreshes by itself." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <LiveCard key={b.matchId} b={b} to={`/watch/${b.matchId}`} />
          ))}
        </div>
      )}
    </>
  );
}

function WatchOne({ matchId }: { matchId: string }) {
  const q = useLiveBroadcasts();
  const card = q.data?.find((c) => c.matchId === matchId);
  // keep title/map on screen after the match drops out of the live list
  const [seen, setSeen] = useState<LiveBroadcastCard | null>(null);
  if (card && card !== seen && (seen?.matchId !== card.matchId || seen.startedAt !== card.startedAt)) setSeen(card);
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const shown = card ?? seen;
  const ended = (!!seen && q.isSuccess && !card) || playerState === "ended";

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground">
      <Link to="/watch">
        <ArrowLeft /> All live matches
      </Link>
    </Button>
  );

  if (q.isError && !shown)
    return (
      <>
        {back}
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the stream" />
      </>
    );
  if (q.isPending)
    return (
      <>
        {back}
        <Skeleton className="mb-4 h-10 w-72" />
        <Skeleton className="aspect-video w-full rounded-xl" />
      </>
    );
  if (!shown)
    return (
      <>
        {back}
        <EmptyState
          icon={<MonitorOff />}
          title="This match isn't live right now"
          description="The broadcast may not have started yet, or it has ended."
          action={
            <Button asChild>
              <Link to="/watch">
                <Radio /> See what's live
              </Link>
            </Button>
          }
        />
      </>
    );

  const copy = () =>
    void navigator.clipboard.writeText(watchUrl(shown.matchId)).then(
      () => toast.success("Link copied", { description: "Share it — anyone can watch." }),
      () => toast.error("Couldn't copy the link"),
    );

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.25em] text-destructive uppercase">{ended ? "Stream ended" : "Live"}</p>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold sm:text-3xl">
            <span className="min-w-0">
              {shown.title} · Match {shown.number}
            </span>
            <MapChip map={shown.map} className="text-sm" />
          </h1>
          <p className="text-sm text-muted-foreground">
            {shown.organizer.name} · {shown.subtitle}
          </p>
        </div>
        <Button variant="outline" onClick={copy}>
          <Copy /> Share link
        </Button>
      </div>
      <div className="-mx-4 sm:mx-0">
        <HlsPlayer
          src={shown.hlsUrl}
          startedAt={shown.startedAt}
          ended={ended}
          onStateChange={setPlayerState}
          showLiveBadge={!shown.overlayUrl}
          dvr
          frameClassName="rounded-none border-x-0 sm:rounded-xl sm:border-x"
          endedSlot={
            <div className="max-w-md space-y-3 rounded-xl border bg-card/95 p-4 text-center shadow-sm backdrop-blur-sm sm:p-5">
              <MonitorOff className="mx-auto size-7 text-muted-foreground" />
              <p className="text-sm font-medium">The broadcast has ended.</p>
              <Button asChild>
                <Link to="/watch">See what's live</Link>
              </Button>
            </div>
          }
        >
          {shown.overlayUrl && !ended && <LiveOverlay url={shown.overlayUrl} />}
        </HlsPlayer>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">The stream runs about 5–10 seconds behind the game.</p>
    </>
  );
}

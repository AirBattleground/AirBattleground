import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Clapperboard, Loader2, Plus, Radio, Smartphone, Trash2, Tv, WifiOff } from "lucide-react";
import type { StudioShowRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useDevices } from "@/features/devices/api";
import { useUpcomingMatches } from "@/features/broadcast/api";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { useCreateShow, useDeleteShow, useShows } from "@/features/studio/api";

const TOUR: TourStep[] = [
  { title: "Studio", description: "Produce a live show like a TV broadcast: mix your phones, webcam, scorecard, MVP and intro videos, and switch between scenes." },
  { element: '[data-tour="studio-sources"]', title: "Your sources", description: "Every phone you've added. A green dot means its video is reaching the server right now.", side: "bottom" },
  { element: '[data-tour="studio-new"]', title: "Create a show", description: "Give it a name and (optionally) the match — then open the studio console.", side: "bottom" },
  { element: '[data-tour="studio-shows"]', title: "Your shows", description: "Open a show to set up scenes and go live. You can reuse a show for many streams.", side: "top" },
];

const NO_MATCH = "none";

/** /manager/studio?match=<id>&title=… (from a match center): open that match's show, creating it the first time. */
function useOpenForMatch(shows: StudioShowRow[] | undefined) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateShow();
  const done = useRef(false);
  const matchId = params.get("match");
  useEffect(() => {
    if (!matchId || !shows || done.current) return;
    done.current = true;
    const existing = shows.find((s) => s.match?.id === matchId);
    if (existing) {
      navigate(`/manager/studio/${existing.id}`, { replace: true });
      return;
    }
    const title = (params.get("title") ?? "Match stream").slice(0, 80);
    create.mutate({ title: title.length >= 2 ? title : "Match stream", matchId }, { onSuccess: (s) => navigate(`/manager/studio/${s.id}`, { replace: true }) });
  }, [matchId, shows, params, navigate, create]);
  return !!matchId;
}

export default function StudioPage() {
  usePageTour("manager.studio", TOUR);
  const shows = useShows();
  const opening = useOpenForMatch(shows.data);
  const devices = useDevices();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StudioShowRow | null>(null);
  const del = useDeleteShow();

  if (opening)
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        Opening the Studio for this match…
      </div>
    );

  return (
    <>
      <PageHeader
        eyebrow="Broadcast"
        title="Studio"
        description="Mix your device streams, webcam, scorecard and intro videos into one professional live show."
        actions={
          <Button size="lg" data-tour="studio-new" className="shadow-glow" onClick={() => setCreating(true)}>
            <Plus /> New show
          </Button>
        }
      />

      <section data-tour="studio-sources" className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Smartphone className="size-5 text-primary" /> Device sources
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/manager/devices">Manage devices</Link>
          </Button>
        </div>
        {!devices.data ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : devices.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices yet. <Link to="/manager/devices" className="font-semibold text-primary hover:underline">Add an iPhone</Link> — its stream becomes a Studio source.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {devices.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
                <span className={cn("size-2.5 shrink-0 rounded-full", d.videoReady ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-muted-foreground/40")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">{d.videoReady ? "Streaming — ready to use" : d.status === "OFFLINE" ? "Offline" : "Connected, not streaming"}</span>
                </span>
                {d.videoReady ? <Radio className="size-4 text-success" /> : <WifiOff className="size-4 text-muted-foreground" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-tour="studio-shows" className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Clapperboard className="size-5 text-primary" /> Shows
        </h2>
        {shows.isError ? (
          <QueryError error={shows.error} onRetry={() => void shows.refetch()} title="We couldn't load your shows" />
        ) : !shows.data ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : shows.data.length === 0 ? (
          <EmptyState
            icon={<Clapperboard />}
            title="Make your first show"
            description="A show is your broadcast setup: scenes (one phone, two side by side, host + game, scorecard, MVP) and an intro video. Create one, then go live from the console."
            action={
              <Button size="lg" onClick={() => setCreating(true)}>
                <Plus /> New show
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shows.data.map((s) => (
              <div key={s.id} className={cn("group relative flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40", s.state === "LIVE" && "border-destructive/50")}>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/manager/studio/${s.id}`} className="min-w-0 after:absolute after:inset-0">
                    <p className="truncate font-display text-xl font-bold group-hover:text-primary">{s.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{s.match ? `${s.match.title} · ${s.match.subtitle}` : "No match linked"}</p>
                  </Link>
                  {s.state === "LIVE" ? (
                    <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">● LIVE</span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{s.state === "ENDED" ? "Ended" : "Ready"}</span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Edited {formatDistanceToNow(parseISO(s.updatedAt), { addSuffix: true })}</span>
                  <span className="relative z-10 flex gap-1">
                    <Button asChild size="sm">
                      <Link to={`/manager/studio/${s.id}`}>
                        <Tv /> Open studio
                      </Link>
                    </Button>
                    {s.state !== "LIVE" && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.title}`} onClick={() => setDeleting(s)}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <NewShowDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="Its scenes and settings are removed. Prop videos stay in this browser."
        confirmLabel="Delete show"
        destructive
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}

function NewShowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateShow();
  const matches = useUpcomingMatches();
  const [title, setTitle] = useState("");
  const [matchId, setMatchId] = useState<string>(NO_MATCH);
  const ok = title.trim().length >= 2;
  const submit = () =>
    create.mutate(
      { title: title.trim(), matchId: matchId === NO_MATCH ? null : matchId },
      {
        onSuccess: (s) => {
          onOpenChange(false);
          setTitle("");
          navigate(`/manager/studio/${s.id}`);
        },
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New show</DialogTitle>
          <DialogDescription>Name your show. Linking a match lets the scorecard and MVP scenes show its results.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="show-title">Show name</Label>
            <Input id="show-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday Night Scrims — Live" autoFocus onKeyDown={(e) => e.key === "Enter" && ok && submit()} />
          </div>
          <div className="grid gap-1.5">
            <Label>Match (optional)</Label>
            <Select value={matchId} onValueChange={setMatchId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MATCH}>No match</SelectItem>
                {(matches.data ?? []).map((m) => (
                  <SelectItem key={m.matchId} value={m.matchId}>
                    {m.title} · {m.subtitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ok || create.isPending} onClick={submit}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Clapperboard />} Create & open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

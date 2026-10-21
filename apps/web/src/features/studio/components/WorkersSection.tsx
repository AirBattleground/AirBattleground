import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Link2, Radio, Server, Trash2 } from "lucide-react";
import type { StudioWorkerRow } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useDeleteWorker, useWorkers } from "../api";
import { ConnectStudioDialog } from "./ConnectStudioDialog";

/** The manager's connected studios: 7XEN Studio apps linked to the account by QR (each one holds a studio key). */
export function WorkersSection() {
  const workers = useWorkers();
  const del = useDeleteWorker();
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState<StudioWorkerRow | null>(null);

  return (
    <section data-tour="studio-connected" className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Server className="size-5 text-primary" /> Connected studios
          </h2>
          <p className="text-sm text-muted-foreground">The venue PCs running 7XEN Studio that are linked to your account.</p>
        </div>
        <Button data-tour="studio-connect" className="shadow-glow" onClick={() => setConnecting(true)}>
          <Link2 /> Connect a studio
        </Button>
      </div>
      {workers.isError ? (
        <p className="text-sm text-muted-foreground">
          We couldn't load your connected studios.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void workers.refetch()}>
            Try again
          </button>
        </p>
      ) : !workers.data ? (
        <Skeleton className="h-14 rounded-lg" />
      ) : workers.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No studios connected yet. Press “Connect a studio” and scan the QR in 7XEN Studio on your venue PC.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {workers.data.map((w) => (
            <WorkerItem key={w.id} worker={w} onRemove={() => setRemoving(w)} />
          ))}
        </ul>
      )}

      <ConnectStudioDialog open={connecting} onOpenChange={setConnecting} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.name ?? "this studio"}”?`}
        description={removing?.showId ? "It's streaming right now — the stream stops. Its key stops working." : "Its key stops working. You can connect it again any time with a new key."}
        confirmLabel="Remove studio"
        destructive
        onConfirm={() => {
          if (removing) del.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </section>
  );
}

function WorkerItem({ worker: w, onRemove }: { worker: StudioWorkerRow; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
      <span className={cn("size-2.5 shrink-0 rounded-full", w.online ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-muted-foreground/40")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{w.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {w.online ? "Online" : w.lastSeenAt ? `Offline · last seen ${formatDistanceToNow(parseISO(w.lastSeenAt), { addSuffix: true })}` : "Offline · never connected"}
        </span>
        {w.showId && (
          <span className="flex items-center gap-1 truncate text-xs font-semibold text-destructive">
            <Radio className="size-3" /> Streaming now
          </span>
        )}
        {w.error && (
          <span className="block truncate text-xs text-destructive" title={w.error}>
            {w.error}
          </span>
        )}
      </span>
      <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${w.name}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </li>
  );
}

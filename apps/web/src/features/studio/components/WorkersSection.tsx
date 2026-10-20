import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Check, Copy, Loader2, Plus, Radio, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, createWorkerSchema, type CreateWorkerInput, type StudioShowRow, type StudioWorkerRow } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/features/manager/api";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useCreateWorker, useDeleteWorker, useWorkers } from "../api";

/** Studio page: the manager's Studio workers (PCs / servers that run a show so closing the browser doesn't stop it). */
export function WorkersSection({ shows }: { shows: StudioShowRow[] | undefined }) {
  const workers = useWorkers();
  const del = useDeleteWorker();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StudioWorkerRow | null>(null);

  return (
    <section data-tour="studio-workers" className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Server className="size-5 text-primary" /> Studio workers
          </h2>
          <p className="text-sm text-muted-foreground">A PC or server that runs your show — it keeps going even if you close this browser.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add worker
        </Button>
      </div>
      {workers.isError ? (
        <p className="text-sm text-muted-foreground">
          We couldn't load your workers.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void workers.refetch()}>
            Try again
          </button>
        </p>
      ) : !workers.data ? (
        <Skeleton className="h-14 rounded-lg" />
      ) : workers.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workers yet. Shows run in your browser — add a worker to run them on a stronger computer instead.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {workers.data.map((w) => (
            <WorkerItem key={w.id} worker={w} show={shows?.find((s) => s.id === w.showId) ?? null} onRemove={() => setRemoving(w)} />
          ))}
        </ul>
      )}

      <AddWorkerDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.name ?? "this worker"}”?`}
        description={removing?.showId ? "It's running a show right now — the show stops. Its key stops working." : "Its key stops working. You can add it again any time with a new key."}
        confirmLabel="Remove worker"
        destructive
        onConfirm={() => {
          if (removing) del.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </section>
  );
}

function WorkerItem({ worker: w, show, onRemove }: { worker: StudioWorkerRow; show: StudioShowRow | null; onRemove: () => void }) {
  const gpu = !!w.encoder && w.encoder !== "libx264";
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
      <span className={cn("size-2.5 shrink-0 rounded-full", w.online ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-muted-foreground/40")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{w.name}</span>
          {w.encoder && (
            <span className={cn("shrink-0 rounded px-1 text-[10px] font-bold", gpu ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} title={`Encoder: ${w.encoder}`}>
              {gpu ? "GPU" : "CPU"}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {w.online ? "Online" : w.lastSeenAt ? `Offline · last seen ${formatDistanceToNow(parseISO(w.lastSeenAt), { addSuffix: true })}` : "Offline · never connected"}
        </span>
        {w.showId && (
          <span className="flex items-center gap-1 truncate text-xs font-semibold text-destructive">
            <Radio className="size-3" /> Running {show ? `“${show.title}”` : "a show"}
          </span>
        )}
        {w.error && <span className="block truncate text-xs text-destructive" title={w.error}>{w.error}</span>}
      </span>
      <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${w.name}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </li>
  );
}

function AddWorkerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateWorker();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<CreateWorkerInput>({ resolver: zodResolver(createWorkerSchema), defaultValues: { name: "" } });

  useEffect(() => {
    if (open) {
      form.reset({ name: "" });
      setKey(null);
      setCopied(false);
    }
  }, [open, form]);

  const submit = form.handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: (r) => setKey(r.key),
      onError: (e) => {
        if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) form.setError(k as keyof CreateWorkerInput, { message: m });
        else toast.error("Couldn't add the worker", { description: errorMessage(e) });
      },
    }),
  );

  const copy = () =>
    key &&
    void navigator.clipboard.writeText(key).then(
      () => (setCopied(true), toast.success("Key copied")),
      () => toast.error("Couldn't copy — select the key and copy it"),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {key ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Worker added</DialogTitle>
              <DialogDescription>Copy this key now — it's shown only once.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all" title={key}>
                {key}
              </code>
              <Button size="icon" variant="outline" aria-label="Copy key" onClick={copy}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <ol className="space-y-2 text-sm">
              {["Install the worker on your PC or studio server", "Put this key in its .env as WORKER_KEY", "Start it — it shows Online here"].map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a Studio worker</DialogTitle>
              <DialogDescription>Name the computer that will run your shows. You'll get a key to put on it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="worker-name">Worker name</Label>
              <Input id="worker-name" placeholder="e.g. Studio PC" autoFocus {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add worker
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

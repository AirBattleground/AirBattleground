import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Check, Copy, ExternalLink, Link2, Loader2, Plus, Radio, Server, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, BOX_DEFAULT_PORT, createWorkerSchema, type CreateWorkerInput, type StudioShowRow, type StudioWorkerRow } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/features/manager/api";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useCreateWorker, useDeleteWorker, useWorkers } from "../api";
import { isThisBox } from "../box";
import { ConnectStudioDialog } from "./ConnectStudioDialog";

/**
 * Studio page: the manager's connected studios — a 7XEN Studio app linked by QR (studioLink.ts), Studio boxes (phase 8c
 * — a venue PC that runs the phones and the show, see studioBox.ts) and plain Studio workers (phase 8b). All of them are
 * Studio worker keys.
 */
export function WorkersSection({ shows }: { shows: StudioShowRow[] | undefined }) {
  const workers = useWorkers();
  const del = useDeleteWorker();
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState<StudioWorkerRow | null>(null);

  return (
    <section data-tour="studio-workers" className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Server className="size-5 text-primary" /> Connected studios
          </h2>
          <p className="text-sm text-muted-foreground">The PCs that run your show: 7XEN Studio linked to your account, or a Studio box at the venue.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add Studio box
          </Button>
          <Button size="sm" data-tour="studio-connect" onClick={() => setConnecting(true)}>
            <Link2 /> Connect a studio
          </Button>
        </div>
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
            <WorkerItem key={w.id} worker={w} show={shows?.find((s) => s.id === w.showId) ?? null} onRemove={() => setRemoving(w)} />
          ))}
        </ul>
      )}

      <AddWorkerDialog open={adding} onOpenChange={setAdding} />
      <ConnectStudioDialog open={connecting} onOpenChange={setConnecting} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.name ?? "this studio"}”?`}
        description={removing?.showId ? "It's running a show right now — the show stops. Its key stops working." : "Its key stops working. You can connect it again any time with a new key."}
        confirmLabel={removing?.box ? "Remove box" : "Remove studio"}
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
  const box = w.box ?? null;
  const here = isThisBox(w);
  // a 7XEN Studio app never polls as a worker, so it reports no encoder
  const kind = box ? "Studio box" : w.encoder ? "Studio worker" : "7XEN Studio";
  const running = !!w.showId && (!show || show.state === "LIVE");
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-background/50 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className={cn("size-2.5 shrink-0 rounded-full", w.online ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-muted-foreground/40")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{w.name}</span>
            {w.encoder && (
              <span className={cn("shrink-0 rounded px-1 text-[10px] font-bold", gpu ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} title={`Encoder: ${w.encoder}`}>
                {gpu ? "GPU" : "CPU"}
              </span>
            )}
            {here && <span className="shrink-0 rounded bg-primary/15 px-1 text-[10px] font-bold text-primary">THIS BOX</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {kind} ·{" "}
            {w.online ? "Online" : w.lastSeenAt ? `Offline · last seen ${formatDistanceToNow(parseISO(w.lastSeenAt), { addSuffix: true })}` : "Offline · never connected"}
          </span>
          {box && (
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Smartphone className="size-3" /> {box.devices} {box.devices === 1 ? "phone" : "phones"} paired
                {box.streaming > 0 && <span className="font-semibold text-success">· {box.streaming} streaming</span>}
              </span>
              <span className="truncate font-mono text-[11px]" title={box.lanUrl}>
                {box.lanUrl.replace(/^https?:\/\//, "")}
              </span>
            </span>
          )}
          {running && (
            <span className="flex items-center gap-1 truncate text-xs font-semibold text-destructive">
              <Radio className="size-3" /> Broadcasting {show ? `“${show.match ? `${show.match.title} · ${show.match.subtitle}` : show.title}”` : "a show"}
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
      </div>
      {box && w.online && !here && (
        <Button asChild size="sm" className="w-full">
          <a href={`${box.lanUrl.replace(/\/+$/, "")}/manager/studio`} target="_blank" rel="noreferrer">
            <ExternalLink /> Open Studio on {w.name}
          </a>
        </Button>
      )}
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
        else toast.error("Couldn't add the Studio box", { description: errorMessage(e) });
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
              <DialogTitle>Studio box added</DialogTitle>
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
              {[
                "Install the Studio box on a PC at the venue (same Wi-Fi as the phones)",
                "Put this key in its .env as BOX_KEY (or WORKER_KEY) and start it",
                `It shows Online here — then open http://<pc-ip>:${BOX_DEFAULT_PORT} (or “Open Studio on …”) to add phones`,
              ].map((t, i) => (
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
              <DialogTitle>Add a Studio box</DialogTitle>
              <DialogDescription>Name the venue PC that will run your phones and shows. You'll get a key to put on it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="worker-name">Box name</Label>
              <Input id="worker-name" placeholder="e.g. Arena PC" autoFocus {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add box
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

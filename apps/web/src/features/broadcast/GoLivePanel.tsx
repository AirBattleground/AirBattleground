import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Loader2, Plus, Radio, Square, Trash2, Tv, Youtube } from "lucide-react";
import {
  ApiError,
  DESTINATION_PRESETS,
  streamDestinationSchema,
  type DestinationKind,
  type DeviceOutput,
  type StreamDestinationInput,
} from "@7xen/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Checkbox } from "@7xen/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/features/manager/api";
import { useCreateDestination, useDeleteDestination, useDestinations, useDeviceOutput, useStartOutput, useStopOutput } from "./output";

const STATE_TEXT: Record<DeviceOutput["state"], string> = {
  OFF: "Off",
  STARTING: "Starting…",
  LIVE: "Live",
  RECONNECTING: "Reconnecting…",
  ERROR: "Problem",
};

/**
 * Device page: start / stop the broadcast output (phone video + your layout) and pick where it goes. While the site
 * YouTube channel is connected (admin), a match also goes live there by itself.
 */
export function GoLivePanel({ deviceId, videoReady, hasMatch }: { deviceId: string; videoReady: boolean; hasMatch: boolean }) {
  const out = useDeviceOutput(deviceId);
  const dests = useDestinations();
  const start = useStartOutput(deviceId);
  const stop = useStopOutput(deviceId);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [manage, setManage] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const o = out.data;
  const running = !!o && o.state !== "OFF";
  const list = dests.data ?? [];
  const chosen = picked ?? list.map((d) => d.id);

  return (
    <section data-tour="device-go-live" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Radio className={cn("size-5", running ? "text-destructive" : "text-primary")} /> Broadcast
        </h2>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-bold",
            o?.state === "LIVE" ? "bg-destructive text-destructive-foreground" : running ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground",
          )}
        >
          {o ? STATE_TEXT[o.state] : "…"}
        </span>
      </div>

      {running ? (
        <>
          {o.match && (
            <p className="text-sm">
              <span className="font-semibold">{o.match.title}</span> <span className="text-muted-foreground">· {o.match.subtitle}</span>
            </p>
          )}
          {o.error && <p className="rounded-lg bg-warning/10 p-2 text-sm">{o.error}</p>}
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-success" /> AirBattleground live page
            </li>
            {o.destinations
              .filter((x) => x.id !== "site-youtube")
              .map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", x.ok ? "bg-success" : "bg-warning")} /> {x.name}
                  {!x.ok && <span className="text-xs text-muted-foreground">connecting…</span>}
                </li>
              ))}
          </ul>
          {o.youtube && (
            <div className={cn("rounded-lg border p-2.5 text-sm", o.youtube.error ? "border-destructive/40 bg-destructive/5" : "border-destructive/20")}>
              <p className="flex items-center gap-1.5 font-semibold">
                <Youtube className="size-4 text-destructive" /> AirBattleground YouTube
                {!o.youtube.error && <span className={cn("ml-auto size-2 rounded-full", o.youtube.ok ? "bg-success" : "bg-warning")} />}
              </p>
              {o.youtube.error ? (
                <p className="mt-1 text-xs text-destructive">{o.youtube.error}</p>
              ) : (
                <>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{o.youtube.title}</p>
                  {o.youtube.watchUrl && (
                    <a href={o.youtube.watchUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      Watch on YouTube <ExternalLink className="size-3" />
                    </a>
                  )}
                </>
              )}
            </div>
          )}
          <Button variant="outline" className="w-full text-destructive" disabled={stop.isPending} onClick={() => setConfirmStop(true)}>
            <Square /> Stop broadcast
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Sends the phone's video with your layout to the AirBattleground live page{list.length ? " and the channels you tick" : ""}.{" "}
            {hasMatch ? "If the site YouTube channel is connected, the match goes live there too." : "Pick a match above so viewers see the right title."}
          </p>
          {list.length > 0 && (
            <ul className="space-y-1.5">
              {list.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`dest-${d.id}`}
                    checked={chosen.includes(d.id)}
                    onCheckedChange={(on) => setPicked(on ? [...chosen, d.id] : chosen.filter((x) => x !== d.id))}
                  />
                  <Label htmlFor={`dest-${d.id}`} className="font-medium">
                    {d.name} <span className="text-xs font-normal text-muted-foreground">· {DESTINATION_PRESETS[d.kind].label}</span>
                  </Label>
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" size="lg" disabled={!videoReady || start.isPending} onClick={() => start.mutate(chosen)}>
            {start.isPending ? <Loader2 className="animate-spin" /> : <Radio />} Go live
          </Button>
          {!videoReady && <p className="text-xs text-muted-foreground">Start streaming on the phone first.</p>}
        </>
      )}
      <button type="button" onClick={() => setManage(true)} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
        <Tv className="size-3.5" /> Your channels ({list.length})
      </button>

      <DestinationsDialog open={manage} onOpenChange={setManage} />

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop the broadcast?</AlertDialogTitle>
            <AlertDialogDescription>Viewers on AirBattleground and every channel stop seeing the match. The phone keeps streaming to you.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep live</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                stop.mutate(undefined, { onSettled: () => setConfirmStop(false) });
              }}
            >
              Stop broadcast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Your own channels: paste a stream key from YouTube Studio / Facebook / any RTMP server. */
function DestinationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const dests = useDestinations();
  const create = useCreateDestination();
  const remove = useDeleteDestination();
  const form = useForm<StreamDestinationInput>({
    resolver: zodResolver(streamDestinationSchema),
    defaultValues: { kind: "YOUTUBE", name: "My YouTube", url: DESTINATION_PRESETS.YOUTUBE.url, streamKey: "" },
  });
  const { register, handleSubmit, setValue, watch, setError, reset, formState } = form;
  const kind = watch("kind");
  const pickKind = (k: DestinationKind) => {
    setValue("kind", k);
    setValue("url", DESTINATION_PRESETS[k].url, { shouldValidate: k !== "CUSTOM" });
    setValue("name", k === "CUSTOM" ? "" : `My ${DESTINATION_PRESETS[k].label}`);
  };
  const submit = handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: () => reset({ kind: "YOUTUBE", name: "My YouTube", url: DESTINATION_PRESETS.YOUTUBE.url, streamKey: "" }),
      onError: (e) => {
        if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) setError(k as keyof StreamDestinationInput, { message: m });
        else setError("root", { message: errorMessage(e) });
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your channels</DialogTitle>
          <DialogDescription>Stream to your own YouTube or Facebook too. Paste the stream key from YouTube Studio → Go live → Stream.</DialogDescription>
        </DialogHeader>

        {(dests.data ?? []).length > 0 && (
          <ul className="divide-y rounded-lg border">
            {dests.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {DESTINATION_PRESETS[d.kind].label} · key {d.keyHint}
                  </span>
                </span>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.name}`} disabled={remove.isPending} onClick={() => remove.mutate(d.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-semibold">Add a channel</p>
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && pickKind(v as DestinationKind)} className="justify-start">
            {(Object.keys(DESTINATION_PRESETS) as DestinationKind[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="px-3">
                {DESTINATION_PRESETS[k].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-1.5">
            <Label htmlFor="dest-name">Name</Label>
            <Input id="dest-name" {...register("name")} aria-invalid={!!formState.errors.name || undefined} />
            {formState.errors.name && <p className="text-xs text-destructive">{formState.errors.name.message}</p>}
          </div>
          {kind === "CUSTOM" && (
            <div className="grid gap-1.5">
              <Label htmlFor="dest-url">Server URL</Label>
              <Input id="dest-url" placeholder="rtmp://…" {...register("url")} aria-invalid={!!formState.errors.url || undefined} />
              {formState.errors.url && <p className="text-xs text-destructive">{formState.errors.url.message}</p>}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="dest-key">Stream key</Label>
            <Input id="dest-key" type="password" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" {...register("streamKey")} aria-invalid={!!formState.errors.streamKey || undefined} />
            {formState.errors.streamKey && <p className="text-xs text-destructive">{formState.errors.streamKey.message}</p>}
          </div>
          {formState.errors.root && <p className="text-sm text-destructive">{formState.errors.root.message}</p>}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add channel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

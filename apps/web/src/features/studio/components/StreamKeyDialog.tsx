import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, DESTINATION_PRESETS, streamDestinationSchema, type DestinationKind, type StreamDestinationInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { toast } from "sonner";
import { errorMessage } from "@/features/manager/api";
import { useCreateDestination } from "@/features/broadcast/output";
import { studioKeys } from "../api";

const EMPTY: StreamDestinationInput = { kind: "YOUTUBE", name: "My YouTube", url: DESTINATION_PRESETS.YOUTUBE.url, streamKey: "" };

/** Save a stream key (YouTube / Facebook / any RTMP) the Studio can push the show to. */
export function StreamKeyDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useCreateDestination();
  const form = useForm<StreamDestinationInput>({ resolver: zodResolver(streamDestinationSchema), defaultValues: EMPTY });
  const kind = form.watch("kind");

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const submit = form.handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: (d) => {
        void qc.invalidateQueries({ queryKey: [...studioKeys.all, "outputs"] });
        onAdded(d.id);
        onOpenChange(false);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) form.setError(k as keyof StreamDestinationInput, { message: m });
        else toast.error("Couldn't save the stream key", { description: errorMessage(e) });
      },
    }),
  );

  const err = (k: keyof StreamDestinationInput) => form.formState.errors[k]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a stream key</DialogTitle>
            <DialogDescription>
              {kind === "YOUTUBE" ? "In YouTube Studio open Go live → Stream, copy the stream key and paste it here." : "Paste the server URL and stream key from your platform."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    const k = v as DestinationKind;
                    field.onChange(k);
                    form.setValue("url", DESTINATION_PRESETS[k].url);
                    form.setValue("name", k === "CUSTOM" ? "My channel" : `My ${DESTINATION_PRESETS[k].label}`);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DESTINATION_PRESETS) as DestinationKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {DESTINATION_PRESETS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sk-name">Name</Label>
            <Input id="sk-name" {...form.register("name")} aria-invalid={!!err("name")} />
            {err("name") && <p className="text-xs text-destructive">{err("name")}</p>}
          </div>
          {kind !== "YOUTUBE" && (
            <div className="space-y-1.5">
              <Label htmlFor="sk-url">Server URL</Label>
              <Input id="sk-url" placeholder="rtmp://…" {...form.register("url")} aria-invalid={!!err("url")} />
              {err("url") && <p className="text-xs text-destructive">{err("url")}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sk-key">Stream key</Label>
            <Input id="sk-key" type="password" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" {...form.register("streamKey")} aria-invalid={!!err("streamKey")} />
            {err("streamKey") && <p className="text-xs text-destructive">{err("streamKey")}</p>}
            <p className="text-xs text-muted-foreground">Kept private — only used to send your show there.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save stream key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

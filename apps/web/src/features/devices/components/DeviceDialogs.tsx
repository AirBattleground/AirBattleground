import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, KeyRound, Link2, Play, Smartphone, Wifi } from "lucide-react";
import { deviceNameSchema, devicePairUrl, type DeviceNameInput, type DeviceRow, type DeviceWithKey } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { applyApiError } from "@/features/player/forms";
import { useCreateDevice, useDeviceKey, useRenameDevice } from "../api";
import { PairQr } from "./PairQr";

// ---------------------------------------------------------------- add / rename

/** `device` given → rename, otherwise add. `onCreated` gets the new device (with its key). */
export function DeviceNameDialog({ open, onOpenChange, device, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device?: DeviceRow | null;
  onCreated?: (d: DeviceWithKey) => void;
}) {
  const create = useCreateDevice();
  const rename = useRenameDevice();
  const form = useForm<DeviceNameInput>({ resolver: zodResolver(deviceNameSchema), defaultValues: { name: "" } });
  const { register, handleSubmit, setError, formState, reset } = form;

  useEffect(() => {
    if (open) reset({ name: device?.name ?? "" });
  }, [open, device, reset]);

  const busy = create.isPending || rename.isPending;
  const onSubmit = handleSubmit(async (values) => {
    try {
      if (device) {
        await rename.mutateAsync({ id: device.id, name: values.name });
        onOpenChange(false);
      } else {
        const d = await create.mutateAsync(values);
        onOpenChange(false);
        onCreated?.(d);
      }
    } catch (e) {
      const left = applyApiError(e, setError, ["name"]);
      if (left) toast.error(left);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{device ? "Rename device" : "Add an iPhone"}</DialogTitle>
            <DialogDescription>
              {device ? "Pick a name you'll recognise in Match Center." : "Give the phone a name. Next you'll get the security key to enter in the 7XEN Stream app."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="device-name">Device name</Label>
            <Input id="device-name" placeholder="e.g. Host iPhone 1" autoFocus autoComplete="off" className="h-11 text-base" {...register("name")} aria-invalid={!!formState.errors.name} />
            {formState.errors.name && <p className="text-sm text-destructive">{formState.errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {device ? "Save" : "Add device"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- key

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
    }
  };
  return { copied, copy };
}

const SETUP = [
  { icon: Smartphone, text: "Install 7XEN Stream on the iPhone (TestFlight link from the admin)." },
  { icon: KeyRound, text: "Open it and scan the QR (or paste the key), then tap Connect." },
  { icon: Play, text: "Tap Start streaming → 7XEN Stream → Start Broadcast, then open BGMI." },
];

/** Shows a device's security key with copy buttons and the 3 setup steps. `fresh` = just created / regenerated. */
export function DeviceKeyDialog({ device, fresh, onOpenChange }: { device: Pick<DeviceRow, "id" | "name"> | null; fresh?: boolean; onOpenChange: (open: boolean) => void }) {
  const q = useDeviceKey(device?.id ?? null);
  const [shown, setShown] = useState(!!fresh);
  const { copied, copy } = useCopy();
  useEffect(() => setShown(!!fresh), [device?.id, fresh]);

  const key = q.data?.key;
  const masked = key ? `${key.slice(0, 8)}${"•".repeat(16)}` : "";

  return (
    <Dialog open={!!device} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{fresh ? "Your device key is ready" : "Security key"}</DialogTitle>
          <DialogDescription>
            For <strong className="text-foreground">{device?.name}</strong>. Anyone with this key can stream to your account, so only enter it on your own phone.
          </DialogDescription>
        </DialogHeader>

        {device && (
          <div className="flex flex-col items-center gap-2">
            <PairQr deviceId={device.id} size={200} />
            <p className="text-sm text-muted-foreground">Scan with the 7XEN Stream app, or copy the key below.</p>
          </div>
        )}

        <div data-tour="device-key" className="space-y-3">
          {q.isPending ? (
            <Skeleton className="h-14 rounded-xl" />
          ) : q.isError ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Couldn't load the key. Close this and try again.</p>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2 pl-4">
              <code className="min-w-0 flex-1 truncate font-mono text-base font-semibold tracking-wide select-all">{shown ? key : masked}</code>
              <Button type="button" variant="ghost" size="icon" aria-label={shown ? "Hide key" : "Show key"} onClick={() => setShown((s) => !s)}>
                {shown ? <EyeOff /> : <Eye />}
              </Button>
              <Button type="button" onClick={() => key && void copy("key", key)}>
                {copied === "key" ? <Check /> : <Copy />} {copied === "key" ? "Copied" : "Copy key"}
              </Button>
            </div>
          )}
          {key && (
            <button
              type="button"
              onClick={() => void copy("link", devicePairUrl(window.location.origin, key))}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {copied === "link" ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
              {copied === "link" ? "Setup link copied. Open it on the iPhone." : "Copy setup link (opens the app with the key filled in)"}
            </button>
          )}
        </div>

        <ol className="space-y-3 rounded-xl border bg-muted/40 p-4">
          {SETUP.map((s, i) => (
            <li key={s.text} className="flex items-start gap-3 text-sm">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display font-bold text-primary")}>{i + 1}</span>
              <span className="pt-1">{s.text}</span>
            </li>
          ))}
          <li className="flex items-start gap-3 text-sm text-muted-foreground">
            <Wifi className="mt-0.5 size-4 shrink-0" /> The device shows <strong className="mx-1 text-foreground">Online</strong> here as soon as the app connects.
          </li>
        </ol>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

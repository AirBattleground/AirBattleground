import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { QRCodeSVG } from "qrcode.react";
import { Battery, BatteryCharging, Check, Copy, Loader2, MoreVertical, Pencil, Plus, Thermometer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, boxDeviceNameSchema, type BoxDevice, type BoxDeviceNameInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/features/manager/api";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useCreateBoxDevice, useDeleteBoxDevice, useRenameBoxDevice } from "../box";

const THERMAL: Record<string, { label: string; className: string }> = {
  nominal: { label: "Cool", className: "text-success" },
  fair: { label: "Warm", className: "text-success" },
  serious: { label: "Hot", className: "text-warning-foreground dark:text-warning" },
  critical: { label: "Too hot", className: "text-destructive" },
};

function healthOf(d: BoxDevice) {
  const h = d.health ?? {};
  const battery = typeof h.battery === "number" ? h.battery : null;
  const charging = h.charging === true;
  const thermal = typeof h.thermal === "string" ? (THERMAL[h.thermal] ?? null) : null;
  return { battery, charging, thermal };
}

/** Studio console (on a Studio Box): the phones paired on this box, with Add / Rename / Remove. */
export function BoxPhonesList({ devices }: { devices: BoxDevice[] }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<BoxDevice | null>(null);
  const [removing, setRemoving] = useState<BoxDevice | null>(null);
  const del = useDeleteBoxDevice();

  return (
    <div className="space-y-2">
      {devices.length === 0 && <p className="text-xs text-muted-foreground">No phones yet. Add one, then scan its QR in the 7XEN Stream app.</p>}
      <ul className="space-y-1.5">
        {devices.map((d) => {
          const h = healthOf(d);
          return (
            <li key={d.id} className="flex items-center gap-2 rounded-md border bg-background/50 px-2 py-1.5 text-sm">
              <span className={cn("size-2 shrink-0 rounded-full", d.videoReady ? "bg-success shadow-[0_0_6px_var(--success)]" : d.online ? "bg-warning" : "bg-muted-foreground/40")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className={cn(d.streaming && "font-semibold text-destructive")}>{d.streaming ? (d.videoReady ? "● Streaming" : "Starting…") : d.online ? "Online" : "Offline"}</span>
                  {d.online && h.battery != null && (
                    <span className="inline-flex items-center gap-0.5" title={h.charging ? "Battery (charging)" : "Battery"}>
                      {h.charging ? <BatteryCharging className="size-3" /> : <Battery className="size-3" />}
                      {Math.round(h.battery * 100)}%
                    </span>
                  )}
                  {d.online && h.thermal && (
                    <span className={cn("inline-flex items-center gap-0.5", h.thermal.className)} title="Temperature">
                      <Thermometer className="size-3" />
                      {h.thermal.label}
                    </span>
                  )}
                </span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`More for ${d.name}`}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(d)}>
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoving(d)}>
                    <Trash2 /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setAdding(true)}>
        <Plus /> Add phone
      </Button>

      <AddPhoneDialog open={adding} onOpenChange={setAdding} />
      <RenamePhoneDialog device={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.name ?? "this phone"}”?`}
        description={removing?.streaming ? "It's streaming right now — its video stops. Scenes that use it go blank." : "It can't stream to this box any more. You can add it again with a new QR."}
        confirmLabel="Remove phone"
        destructive
        onConfirm={() => {
          if (removing) del.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </div>
  );
}

function AddPhoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateBoxDevice();
  const [result, setResult] = useState<{ name: string; key: string; pairUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<BoxDeviceNameInput>({ resolver: zodResolver(boxDeviceNameSchema), defaultValues: { name: "" } });

  useEffect(() => {
    if (open) {
      form.reset({ name: "" });
      setResult(null);
      setCopied(false);
    }
  }, [open, form]);

  const submit = form.handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: (r) => setResult({ name: r.device.name, key: r.key, pairUrl: r.pairUrl }),
      onError: (e) => {
        if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) form.setError(k as keyof BoxDeviceNameInput, { message: m });
        else toast.error("Couldn't add the phone", { description: errorMessage(e) });
      },
    }),
  );

  const copy = () =>
    result &&
    void navigator.clipboard.writeText(result.key).then(
      () => (setCopied(true), toast.success("Key copied")),
      () => toast.error("Couldn't copy — select the key and copy it"),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Connect “{result.name}”</DialogTitle>
              <DialogDescription>Scan this QR with the phone. The QR and key are shown only once.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              {/* always dark-on-white so phone cameras read it in both themes */}
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                <QRCodeSVG value={result.pairUrl} size={196} level="M" bgColor="#ffffff" fgColor="#0a0a0a" aria-label="QR code to connect the phone" />
              </div>
            </div>
            <ol className="space-y-2 text-sm">
              {["Open 7XEN Stream on the phone", "Tap Scan QR and point it at this code", "Tap Start streaming — it turns green here"].map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Can't scan? Enter this key in the app instead:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all" title={result.key}>
                  {result.key}
                </code>
                <Button size="icon" variant="outline" aria-label="Copy key" onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a phone</DialogTitle>
              <DialogDescription>Name the phone (e.g. the player or camera spot). You'll get a QR to scan with it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="box-phone-name">Phone name</Label>
              <Input id="box-phone-name" placeholder="e.g. Caster cam" autoFocus {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add phone
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenamePhoneDialog({ device, onClose }: { device: BoxDevice | null; onClose: () => void }) {
  const rename = useRenameBoxDevice();
  const form = useForm<BoxDeviceNameInput>({ resolver: zodResolver(boxDeviceNameSchema), defaultValues: { name: "" } });

  useEffect(() => {
    if (device) form.reset({ name: device.name });
  }, [device, form]);

  const submit = form.handleSubmit((v) => {
    if (!device) return;
    rename.mutate(
      { id: device.id, name: v.name },
      {
        onSuccess: onClose,
        onError: (e) => {
          if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) form.setError(k as keyof BoxDeviceNameInput, { message: m });
          else toast.error("Couldn't rename the phone", { description: errorMessage(e) });
        },
      },
    );
  });

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename phone</DialogTitle>
            <DialogDescription>Scenes keep using it — only the name changes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="box-phone-rename">Phone name</Label>
            <Input id="box-phone-rename" autoFocus {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

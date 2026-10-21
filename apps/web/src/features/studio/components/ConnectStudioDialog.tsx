import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ApiError, createWorkerSchema, studioConnectLink, type CreateWorkerInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { errorMessage } from "@/features/manager/api";
import { useCreateWorker } from "../api";

const STEPS = ["Open 7XEN Studio on the venue PC", "Go to Settings → Connect AirBattleground", "Scan this QR with the PC's camera (or paste the key)"];

/** "Connect a studio": name it → a studio key → QR `7xen-studio://connect?host=…&key=…` for the 7XEN Studio app (studioLink.ts). */
export function ConnectStudioDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
        else toast.error("Couldn't connect the studio", { description: errorMessage(e) });
      },
    }),
  );

  const link = key ? studioConnectLink(window.location.origin, key) : "";
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => (setCopied(true), toast.success(`${what} copied`)),
      () => toast.error("Couldn't copy — select it and copy it"),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {key ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Scan this in 7XEN Studio</DialogTitle>
              <DialogDescription>This QR is shown only once. Keep this window open until the studio says it's connected.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-border">
                <QRCodeSVG value={link} size={220} level="M" bgColor="#ffffff" fgColor="#0a0a0a" aria-label="QR code to connect 7XEN Studio" />
              </div>
            </div>
            <ol className="space-y-2 text-sm">
              {STEPS.map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
            <div className="space-y-1.5">
              <Label>No camera? Paste this key instead</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all" title={key}>
                  {key}
                </code>
                <Button size="icon" variant="outline" aria-label="Copy key" onClick={() => copy(key, "Key")}>
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => copy(link, "Link")}>
                Copy the full connect link
              </button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Connect a studio</DialogTitle>
              <DialogDescription>Link 7XEN Studio on your venue PC to your account. It can then pick your matches, go live to your outputs and send team lists and results here.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="studio-name">Studio name</Label>
              <Input id="studio-name" placeholder="e.g. Arena PC" autoFocus {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Show QR
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

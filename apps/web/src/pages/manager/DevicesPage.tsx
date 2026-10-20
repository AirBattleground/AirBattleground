import { useState } from "react";
import { Plus, Smartphone } from "lucide-react";
import { DEVICE_ONLINE_WINDOW_MS, type DeviceRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { useDeleteDevice, useDevices, useRegenerateKey } from "@/features/devices/api";
import { DeviceCard } from "@/features/devices/components/DeviceCard";
import { DeviceKeyDialog, DeviceNameDialog } from "@/features/devices/components/DeviceDialogs";

const TOUR: TourStep[] = [
  { title: "Your streaming devices", description: "iPhones that stream BGMI to 7xen. You watch the match and capture the team list and results from Match Center. Nobody can control the phone." },
  { element: '[data-tour="devices-add"]', title: "Add an iPhone", description: "Name the phone, then scan its QR (or enter its key) in the 7XEN Stream app on the phone.", side: "bottom" },
  { element: '[data-tour="devices-stats"]', title: "At a glance", description: "How many phones are online and streaming right now.", side: "bottom" },
  { element: '[data-tour="device-card"]', title: "Live status", description: `Online means the app is open. Streaming means the phone is sending its screen. A phone shows Offline after ${DEVICE_ONLINE_WINDOW_MS / 1000} seconds without a signal.`, side: "top" },
];

export default function DevicesPage() {
  usePageTour("manager.devices", TOUR);
  const q = useDevices();
  const regenerate = useRegenerateKey();
  const remove = useDeleteDevice();

  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<DeviceRow | null>(null);
  const [keyFor, setKeyFor] = useState<{ device: Pick<DeviceRow, "id" | "name">; fresh: boolean } | null>(null);
  const [confirmRegen, setConfirmRegen] = useState<DeviceRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DeviceRow | null>(null);

  const RANK = { STREAMING: 0, ONLINE: 1, OFFLINE: 2 } as const;
  const items = [...(q.data ?? [])].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const online = items.filter((d) => d.status !== "OFFLINE").length;
  const streaming = items.filter((d) => d.status === "STREAMING").length;

  const addButton = (
    <Button size="lg" onClick={() => setAdding(true)} data-tour="devices-add" className="shadow-glow">
      <Plus /> Add iPhone
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Devices"
        description={
          items.length > 0 ? (
            <span data-tour="devices-stats" className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <b className="font-display text-foreground">{items.length}</b> {items.length === 1 ? "phone" : "phones"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success" /> <b className="font-display text-foreground">{online}</b> online
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full bg-destructive", streaming > 0 && "animate-pulse")} /> <b className="font-display text-foreground">{streaming}</b> streaming
              </span>
            </span>
          ) : (
            "iPhones that stream BGMI to 7xen."
          )
        }
        actions={items.length > 0 ? addButton : undefined}
      />

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your devices" />
      ) : q.isPending ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Smartphone />}
          title="Add your first iPhone"
          description="Add it, then scan its QR in the 7XEN Stream app."
          action={addButton}
        />
      ) : (
        <div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                onShowKey={() => setKeyFor({ device: d, fresh: false })}
                onRename={() => setRenaming(d)}
                onRegenerate={() => setConfirmRegen(d)}
                onRemove={() => setConfirmRemove(d)}
              />
            ))}
          </div>
        </div>
      )}

      <DeviceNameDialog open={adding} onOpenChange={setAdding} onCreated={(d) => setKeyFor({ device: d, fresh: true })} />
      <DeviceNameDialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} device={renaming} />
      <DeviceKeyDialog device={keyFor?.device ?? null} fresh={keyFor?.fresh} onOpenChange={(o) => !o && setKeyFor(null)} />

      <ConfirmDialog
        open={!!confirmRegen}
        onOpenChange={(o) => !o && setConfirmRegen(null)}
        title="Make a new key?"
        description={`${confirmRegen?.name ?? "The phone"} is disconnected right away. You'll need to enter the new key in the app on that phone.`}
        confirmLabel="Make new key"
        onConfirm={() => {
          const d = confirmRegen;
          setConfirmRegen(null);
          if (d) regenerate.mutate(d.id, { onSuccess: (r) => setKeyFor({ device: r, fresh: true }) });
        }}
      />
      <ConfirmDialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
        title="Remove this device?"
        description={`${confirmRemove?.name ?? "The phone"} stops streaming and its key stops working. You can add it again later with a new key.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const d = confirmRemove;
          setConfirmRemove(null);
          if (d) remove.mutate(d.id);
        }}
      />
    </>
  );
}

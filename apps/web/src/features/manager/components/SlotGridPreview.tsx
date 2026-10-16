import { MAX_ROOM_SLOTS } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

/** Mini #1–#25 room grid highlighting the slots teams will get. */
export function SlotGridPreview({ firstSlot, slotCount }: { firstSlot: number; slotCount: number }) {
  const last = firstSlot + slotCount - 1;
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-[repeat(13,minmax(0,1fr))]">
      {Array.from({ length: MAX_ROOM_SLOTS }, (_, i) => i + 1).map((n) => {
        const team = n >= firstSlot && n <= last;
        const reserved = n < firstSlot;
        return (
          <div
            key={n}
            title={team ? `Slot #${n}: for teams` : reserved ? `Slot #${n}: reserved` : `Slot #${n}: unused`}
            className={cn(
              "grid aspect-square place-items-center rounded-md border font-display text-sm font-bold transition-all duration-200",
              team && "border-primary/50 bg-primary/15 text-primary shadow-glow",
              reserved && "border-dashed bg-muted/60 text-muted-foreground",
              !team && !reserved && "border-dashed text-muted-foreground/50",
            )}
          >
            {n}
          </div>
        );
      })}
    </div>
  );
}

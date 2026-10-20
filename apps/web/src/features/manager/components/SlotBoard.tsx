import { AnimatePresence, motion } from "framer-motion";
import type { SessionDetail } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { slotLabel } from "../format";

/** Visual grid of every slot in the scrim's range. Filled slots animate in. */
export function SlotBoard({ slots, highlight }: { slots: SessionDetail["slots"]; highlight?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
      {slots.map((s) => (
        <div key={s.slotNumber} className="relative h-12">
          <AnimatePresence mode="popLayout" initial={false}>
            {s.team ? (
              <motion.div
                key={`team-${s.registrationId}`}
                initial={{ opacity: 0, scale: 0.6, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 380, damping: 24 }}
                className={cn(
                  "absolute inset-0 flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5",
                  highlight && s.registrationId === highlight && "ring-2 ring-success shadow-glow",
                )}
              >
                <span className="font-display text-xl font-bold leading-none text-primary tabular-nums">{slotLabel(s.slotNumber)}</span>
                <span className="min-w-0 truncate text-sm font-semibold" title={`${s.team.name} [${s.team.tag}]`}>
                  {s.team.name}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="free"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center gap-2.5 rounded-lg border border-dashed px-2.5 text-muted-foreground"
              >
                <span className="font-display text-xl font-bold leading-none opacity-60 tabular-nums">{slotLabel(s.slotNumber)}</span>
                <span className="text-xs">Free</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/** Text list for pasting into WhatsApp / Discord. */
export function slotListText(title: string, dateLabel: string, timeLabel: string, slots: SessionDetail["slots"]): string {
  const lines = slots.map((s) => `${slotLabel(s.slotNumber)} ${s.team ? `${s.team.name} (${s.team.tag})` : "— free —"}`);
  return [`${title} · ${dateLabel} · ${timeLabel} IST`, "", ...lines].join("\n");
}

import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, MessageSquareWarning } from "lucide-react";
import type { TeamRegistration } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { useCancelRegistration } from "../api";
import { dayLabel, formatTime } from "../format";
import { useNow } from "../useNow";
import { OrganizerBadge, PosterThumb } from "./Branding";
import { CancelDialog } from "./ConfirmDialogs";
import { MapChips } from "./MapChips";
import { TeamStatusBadge } from "./TeamStatus";

/**
 * One registration as a card/row: time, scrim, organiser, status, slot (if approved),
 * rejection reason (if rejected) and a cancel action for upcoming pending/approved.
 */
export function RegistrationCard({
  reg,
  today,
  showDate = false,
  cancellable = true,
  compact = false,
  tourAnchor = false,
}: {
  reg: TeamRegistration;
  today: string;
  showDate?: boolean;
  cancellable?: boolean;
  compact?: boolean;
  tourAnchor?: boolean;
}) {
  const now = useNow(30_000);
  const cancel = useCancelRegistration();
  const [open, setOpen] = useState(false);
  const started = now >= new Date(reg.startsAt).getTime();
  const canCancel = cancellable && !started && (reg.status === "PENDING" || reg.status === "APPROVED");
  const tour = (name: string) => (tourAnchor ? { "data-tour": name } : {});

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-shadow hover:shadow-glow sm:flex-row sm:items-center sm:gap-5",
        reg.status === "APPROVED" && "border-success/40",
        reg.status === "PENDING" && "border-warning/40",
        (reg.status === "CANCELLED" || reg.status === "REJECTED") && "opacity-90",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          reg.status === "APPROVED" ? "bg-success" : reg.status === "PENDING" ? "bg-warning" : reg.status === "REJECTED" ? "bg-destructive" : "bg-muted-foreground/30",
        )}
      />

      {/* time */}
      <div className="flex shrink-0 items-baseline gap-2 sm:w-28 sm:flex-col sm:gap-0.5">
        {showDate && <span className="text-xs font-semibold uppercase tracking-wider text-primary">{dayLabel(reg.date, today)}</span>}
        <span className="font-display text-2xl leading-none font-bold tabular-nums">{formatTime(reg.scrim.startTime)}</span>
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">IST</span>
      </div>

      {!compact && <PosterThumb url={reg.scrim.posterUrl} title={reg.scrim.title} className="hidden size-16 shrink-0 sm:block" />}

      {/* details */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate font-display text-lg leading-tight font-bold">{reg.scrim.title}</p>
        <p className="flex min-w-0 text-sm text-muted-foreground">
          <OrganizerBadge manager={reg.scrim.manager} />
        </p>
        {!compact && <MapChips maps={reg.scrim.maps} />}
        {reg.status === "REJECTED" && reg.rejectionReason && (
          <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <MessageSquareWarning className="mt-0.5 size-3.5 shrink-0" /> {reg.rejectionReason}
          </p>
        )}
        {reg.status === "PENDING" && !started && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> Waiting for the organiser to approve.
          </p>
        )}
      </div>

      {/* status / slot / action */}
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
        {reg.status === "APPROVED" && reg.slotNumber != null ? (
          <motion.div {...tour("reg-slot")} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 16 }}>
            <SlotChip slot={reg.slotNumber} size={compact ? "sm" : "md"} />
          </motion.div>
        ) : (
          <div {...tour("reg-status")}>
            <TeamStatusBadge status={reg.status} />
          </div>
        )}
        {reg.status === "APPROVED" && reg.slotNumber != null && !compact && <TeamStatusBadge status="APPROVED" className="hidden sm:inline-flex" />}
        {canCancel && (
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive sm:ml-0" onClick={() => setOpen(true)} {...tour("reg-cancel")}>
            {reg.status === "APPROVED" ? "Cancel" : "Cancel request"}
          </Button>
        )}
      </div>

      {canCancel && (
        <CancelDialog
          open={open}
          onOpenChange={setOpen}
          summary={{ title: reg.scrim.title, date: reg.date, startTime: reg.scrim.startTime, organiser: reg.scrim.manager.displayName, maps: reg.scrim.maps }}
          approved={reg.status === "APPROVED"}
          slot={reg.slotNumber}
          onConfirm={() => cancel.mutate({ id: reg.id, wasApproved: reg.status === "APPROVED", title: reg.scrim.title })}
        />
      )}
    </div>
  );
}

export function RegistrationCardSkeleton() {
  return (
    <div className="flex items-center gap-5 rounded-xl border bg-card p-4">
      <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-9 w-16 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquareWarning } from "lucide-react";
import type { TeamRegistration } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { useCancelRegistration } from "../api";
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";
import { formatTime, useDayFormat } from "../format";
import { useNow } from "../useNow";
import { OrganizerBadge } from "./Branding";
import { CancelDialog } from "./ConfirmDialogs";
import { MapDots } from "./MapChips";
import { TeamStatusBadge } from "./TeamStatus";

/**
 * One registration as a compact row: time → scrim (organiser, maps) → status or slot, plus
 * the rejection reason (if rejected) and a cancel action for upcoming pending/approved.
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
  const t = useT(scrimUi);
  const { dayLabel } = useDayFormat();
  const now = useNow(30_000);
  const cancel = useCancelRegistration();
  const [open, setOpen] = useState(false);
  const started = now >= new Date(reg.startsAt).getTime();
  const { isLeader } = usePlayerSession();
  const canCancel = cancellable && isLeader && !started && (reg.status === "PENDING" || reg.status === "APPROVED");
  const tour = (name: string) => (tourAnchor ? { "data-tour": name } : {});

  return (
    <div
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 overflow-hidden rounded-xl border bg-card p-3 pl-4 transition-shadow hover:shadow-glow sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:p-4 sm:pl-5",
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
      <div className="flex min-w-[4.5rem] flex-col sm:min-w-[5.5rem]">
        {showDate && <span className="text-[11px] font-semibold tracking-wider whitespace-nowrap text-primary uppercase">{dayLabel(reg.date, today)}</span>}
        <span className="font-display text-xl leading-none font-bold whitespace-nowrap tabular-nums sm:text-2xl">{formatTime(reg.scrim.startTime)}</span>
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">IST</span>
      </div>

      {/* scrim */}
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-display text-base leading-tight font-bold sm:text-lg">{reg.scrim.title}</p>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <OrganizerBadge manager={reg.scrim.manager} className="min-w-0 shrink" />
          {!compact && reg.scrim.maps.length > 0 && <MapDots maps={reg.scrim.maps} className="hidden md:flex" />}
        </div>
        {reg.status === "REJECTED" && reg.rejectionReason && (
          <p className="flex items-start gap-1.5 pt-1 text-xs text-destructive">
            <MessageSquareWarning className="mt-0.5 size-3.5 shrink-0" /> <span className="line-clamp-2">{reg.rejectionReason}</span>
          </p>
        )}
      </div>

      {/* status / slot / action */}
      <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:justify-end">
        {reg.status === "APPROVED" && reg.slotNumber != null ? (
          <motion.div {...tour("reg-slot")} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 16 }}>
            <SlotChip slot={reg.slotNumber} size="sm" />
          </motion.div>
        ) : (
          <div {...tour("reg-status")}>
            <TeamStatusBadge status={reg.status} />
          </div>
        )}
        {canCancel && (
          <Button variant="ghost" className="ml-auto h-10 px-3 text-muted-foreground hover:text-destructive sm:ml-0" onClick={() => setOpen(true)} {...tour("reg-cancel")}>
            {reg.status === "APPROVED" ? t("cancel") : t("cancel_request")}
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
    <div className="flex items-center gap-4 rounded-xl border bg-card p-3 sm:p-4">
      <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-9 w-16 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

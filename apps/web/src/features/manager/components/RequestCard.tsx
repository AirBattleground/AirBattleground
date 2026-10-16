import type { ReactNode } from "react";
import { Check, Clock, Loader2, X } from "lucide-react";
import type { Registration } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { timeAgo } from "../format";

/** A pending team request with big Approve / Reject buttons. */
export function RequestCard({
  reg,
  onApprove,
  onReject,
  full,
  busy,
  compact,
  leading,
  className,
}: {
  reg: Registration;
  onApprove: () => void;
  onReject: () => void;
  /** no slots left: approve disabled */
  full?: boolean;
  busy?: boolean;
  compact?: boolean;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex animate-rise flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/30 sm:flex-row sm:items-center sm:p-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <TeamAvatar name={reg.team.name} tag={reg.team.tag} size={compact ? "md" : "lg"} />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold leading-tight">
            {reg.team.name} <span className="text-sm font-semibold text-muted-foreground">({reg.team.tag})</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {reg.team.captainName && <span>Captain: {reg.team.captainName}</span>}
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> Asked {timeAgo(reg.createdAt)}
            </span>
          </p>
        </div>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button
          variant="outline"
          size={compact ? "default" : "lg"}
          className="flex-1 hover:border-destructive/50 hover:text-destructive sm:flex-none"
          onClick={onReject}
          disabled={busy}
        >
          <X /> Reject
        </Button>
        <Button
          size={compact ? "default" : "lg"}
          className="flex-1 bg-success text-success-foreground hover:bg-success/90 sm:flex-none"
          onClick={onApprove}
          disabled={busy || full}
          title={full ? "All slots are taken" : undefined}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />} {full ? "Full" : "Approve"}
        </Button>
      </div>
    </div>
  );
}

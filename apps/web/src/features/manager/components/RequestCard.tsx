import type { ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { Registration } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { timeAgo } from "../format";

/**
 * A pending team request as one flat row (team · when they asked · Reject / Approve).
 * Put several in a `divide-y` list inside one panel.
 */
export function RequestCard({
  reg,
  onApprove,
  onReject,
  full,
  busy,
  leading,
  className,
}: {
  reg: Registration;
  onApprove: () => void;
  onReject: () => void;
  /** no slots left: approve disabled */
  full?: boolean;
  busy?: boolean;
  /** kept for compatibility — rows are always compact now */
  compact?: boolean;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex animate-rise items-center gap-3 py-2.5 transition-colors", className)}>
      {leading}
      <TeamAvatar name={reg.team.name} tag={reg.team.tag} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight">
          {reg.team.name} <span className="text-xs font-normal text-muted-foreground">[{reg.team.tag}]</span>
        </p>
        <p className="truncate text-xs text-muted-foreground" title={reg.team.captainName ? `Captain: ${reg.team.captainName}` : undefined}>
          Asked {timeAgo(reg.createdAt)}
          {reg.team.captainName && <span className="hidden sm:inline"> · {reg.team.captainName}</span>}
        </p>
      </div>
      <Button
        variant="outline"
        size="icon"
        className="size-10 shrink-0 hover:border-destructive/50 hover:text-destructive"
        onClick={onReject}
        disabled={busy}
        aria-label={`Reject ${reg.team.name}`}
        title="Reject"
      >
        <X />
      </Button>
      <Button
        className="h-10 shrink-0 bg-success text-success-foreground hover:bg-success/90"
        onClick={onApprove}
        disabled={busy || full}
        title={full ? "All slots are taken" : undefined}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Check />} {full ? "Full" : "Approve"}
      </Button>
    </div>
  );
}

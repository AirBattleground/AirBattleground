import { useEffect, useState } from "react";
import { Button } from "@7xen/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Textarea } from "@7xen/ui/components/ui/textarea";

const QUICK_REASONS = ["Slots are full", "Team not eligible", "Duplicate request", "Late registration"];

/** Ask for an optional reason before rejecting (or removing) a team. */
export function RejectDialog({
  open,
  onOpenChange,
  teamName,
  mode = "reject",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  mode?: "reject" | "remove";
  onConfirm: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const remove = mode === "remove";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {remove ? `Remove ${teamName} from this scrim?` : `Reject ${teamName}?`}
          </DialogTitle>
          <DialogDescription>
            {remove
              ? "Their slot will be freed so you can approve another team. The team will see that they were removed."
              : "The team will see that their request was not accepted."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reject-reason">Reason (optional)</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            maxLength={200}
            placeholder="e.g. Slots are full for today"
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(reason.trim() || undefined);
              onOpenChange(false);
            }}
          >
            {remove ? "Remove team" : "Reject request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";

export interface ToggleTarget {
  id: string;
  name: string;
  isActive: boolean;
}

/** Confirm before disabling / enabling a login. */
export function ToggleActiveDialog({
  target,
  kind,
  onClose,
  onConfirm,
}: {
  target: ToggleTarget | null;
  kind: "manager" | "team" | "player";
  onClose: () => void;
  onConfirm: (target: ToggleTarget) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const disabling = target?.isActive ?? true;
  const effect =
    kind === "manager"
      ? "They won't be able to sign in or manage their scrims until you enable them again."
      : kind === "player"
        ? "They won't be able to sign in with Google until you enable them again. They stay in their team."
        : "They won't be able to sign in or register for scrims until you enable them again.";
  const enableText = kind === "player" ? "They'll be able to sign in with Google again." : "They'll be able to sign in again with their current password.";
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">
            {disabling ? "Disable" : "Enable"} {target?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>{disabling ? effect : enableText}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={disabling ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              try {
                await onConfirm(target);
                onClose();
              } catch {
                /* caller toasts */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : disabling ? (kind === "player" ? "Disable player" : "Disable login") : kind === "player" ? "Enable player" : "Enable login"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

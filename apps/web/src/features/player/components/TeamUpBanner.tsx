import { useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import type { MyJoinRequest } from "@7xen/shared";
import { NeedTeamDialog } from "./NeedTeamDialog";
import { PendingJoinCard } from "./NoTeamHome";

/**
 * Phase 5c: one slim nudge on home for a player without a team. Opens the create / join dialog.
 * With a pending join request it shows that instead (the dialog stays mounted so its "Request sent" step can finish).
 */
export function TeamUpBanner({
  pending,
  className,
}: {
  pending?: MyJoinRequest | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {pending ? (
        <PendingJoinCard request={pending} className={className} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-tour="team-up"
          className={cn(
            "group flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left outline-none transition-all hover:border-primary/60 hover:bg-primary/10 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-5",
            className,
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Users className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg leading-tight font-bold">
              Play in scrims with your squad
            </span>
            <span className="block text-sm text-muted-foreground">
              Create a team or join with a code.
            </span>
          </span>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="hidden shrink-0 border-primary/40 sm:inline-flex"
          >
            <span>
              Team up <ArrowRight />
            </span>
          </Button>
          <ArrowRight className="size-5 shrink-0 text-primary sm:hidden" />
        </button>
      )}
      <NeedTeamDialog
        open={open}
        onOpenChange={setOpen}
        title="Team up"
        what="any scrim or tournament"
      />
    </>
  );
}

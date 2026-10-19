import { useState } from "react";
import { Shield, UsersRound } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { JoinCodeForm, PendingJoinCard, useWatchForApproval } from "./NoTeamHome";

/** Shown instead of team-only pages (scrims, slots, results, tournaments) while the player has no team. */
export function NoTeamGate({ what = "this" }: { what?: string }) {
  const [open, setOpen] = useState(false);
  const profile = useWatchForApproval();
  const pending = profile.data?.pendingJoinRequest ?? null;
  return (
    <div className="mx-auto flex max-w-xl animate-rise flex-col items-center rounded-3xl border border-dashed bg-card/60 px-5 py-10 text-center sm:px-10 sm:py-14" data-tour="no-team">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-glow">
        <UsersRound className="size-8" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold">Get into a team first</h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">You'll see {what} as soon as you're in a team. Create your own, or join your friends with their invite code.</p>
      {pending && <PendingJoinCard request={pending} className="mt-5 w-full text-left" />}
      <Button size="lg" className="mt-6 h-12 w-full text-base shadow-glow sm:w-auto sm:px-8" onClick={() => setOpen(true)}>
        <Shield /> Create a team
      </Button>
      <div className="my-5 flex w-full items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or join one <span className="h-px flex-1 bg-border" />
      </div>
      <JoinCodeForm className="w-full text-left" />
      <CreateTeamDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

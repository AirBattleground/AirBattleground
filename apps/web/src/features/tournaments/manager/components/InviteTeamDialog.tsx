import { useEffect, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import type { ManagerTournamentDetail, TeamSummary } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage, useInviteTeam, useTeamSearch } from "../api";

function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Invite a team straight into a later stage (counts toward that stage's invited slots). */
export function InviteTeamDialog({ t, open, onOpenChange, takenTeamIds, invitedPerStage }: {
  t: ManagerTournamentDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  takenTeamIds: Set<string>;
  /** invited entries already placed per stage order */
  invitedPerStage: Record<number, number>;
}) {
  const stages = t.stages.filter((s) => s.order > 1 && s.invitedSlots > 0 && s.status === "PENDING");
  const [stageOrder, setStageOrder] = useState<number | null>(stages[0]?.order ?? null);
  const [q, setQ] = useState("");
  const [team, setTeam] = useState<TeamSummary | null>(null);
  const search = useTeamSearch(useDebounced(q), open);
  const invite = useInviteTeam(t.id);

  useEffect(() => {
    if (open) {
      setQ("");
      setTeam(null);
      setStageOrder(stages[0]?.order ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const results = (search.data ?? []).filter((x) => !takenTeamIds.has(x.id));
  const target = stages.find((s) => s.order === stageOrder);
  const left = target ? target.invitedSlots - (invitedPerStage[target.order] ?? 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <UserPlus className="size-5 text-primary" /> Invite a team
          </DialogTitle>
          <DialogDescription>Invited teams skip the earlier stages and start straight in the stage you pick.</DialogDescription>
        </DialogHeader>
        {stages.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No upcoming stage has invited slots. Add invited teams to a stage in the format (before publishing) to use invites.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Start them in</Label>
              <div className="flex flex-wrap gap-2">
                {stages.map((s) => {
                  const free = s.invitedSlots - (invitedPerStage[s.order] ?? 0);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStageOrder(s.order)}
                      aria-pressed={stageOrder === s.order}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        stageOrder === s.order ? "border-primary bg-primary/10" : "bg-background hover:border-primary/40",
                      )}
                    >
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {free} of {s.invitedSlots} invite{s.invitedSlots === 1 ? "" : "s"} left
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label htmlFor="invite-q" className="mb-2 block">
                Team
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="invite-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by team name or tag" className="h-10 pl-9" autoComplete="off" />
              </div>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Teams">
                {search.isLoading ? (
                  <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Searching…
                  </li>
                ) : search.isError ? (
                  <li className="p-3 text-sm text-destructive">{errorMessage(search.error)}</li>
                ) : results.length === 0 ? (
                  <li className="p-3 text-sm text-muted-foreground">{q ? "No team matches that search." : "No teams to show yet."}</li>
                ) : (
                  results.slice(0, 30).map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={team?.id === x.id}
                        onClick={() => setTeam(x)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          team?.id === x.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
                        )}
                      >
                        <TeamAvatar name={x.name} tag={x.tag} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                        <span className="text-xs text-muted-foreground">{x.tag}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!team || !target || left <= 0 || invite.isPending}
            onClick={() => team && target && invite.mutate({ teamId: team.id, stageOrder: target.order }, { onSuccess: () => onOpenChange(false) })}
          >
            {invite.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            {team && target ? `Invite ${team.name} to the ${target.name}` : "Invite team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

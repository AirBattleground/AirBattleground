import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Trophy } from "lucide-react";
import type { WeeklyBoard } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@7xen/ui/components/ui/radio-group";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate } from "@/features/manager/format";
import { QueryError } from "@/features/manager/components/QueryError";
import { StandingsSkeleton } from "@/features/results/components/Standings";
import { useFinalsTargets, useGiveFinalsSlot, useManagerWeekly } from "@/features/weekly/api";
import { WeeklyBoardView } from "@/features/weekly/WeeklyBoardView";

const TOUR: TourStep[] = [
  { title: "Weekly Board", description: "Every published match of this scrim from Monday to Friday, added up. Teams see the same board." },
  { element: '[data-tour="weekly-leader"]', title: "The week's #1", description: "After Friday's match, give the winner a Finals Slot: a direct place in the final of one of your tournaments." },
  { element: '[data-tour="weekly-table"]', title: "Night by night", description: "Each column is one night. Click a night to open that session's points table." },
];

/** "Give Finals Slot": pick one of your tournaments; the week's #1 is invited straight into its final. */
function GiveFinalsSlot({ board, scrimId, week }: { board: WeeklyBoard; scrimId: string; week: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const targets = useFinalsTargets(open);
  const give = useGiveFinalsSlot(scrimId, week);
  const winner = board.rows[0]!.team.name;
  const usable = (targets.data ?? []).filter((x) => x.invitesLeft > 0);

  return (
    <>
      <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
        <p className="font-display text-lg leading-tight font-bold uppercase">Finals Slot not given yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Send {winner} straight into the final of one of your tournaments.</p>
        <Button className="mt-3 w-full" onClick={() => setOpen(true)}>
          <Trophy /> Give Finals Slot
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give {winner} a Finals Slot</DialogTitle>
            <DialogDescription>They're invited straight into the final stage. The slot shows on their team profile.</DialogDescription>
          </DialogHeader>
          {targets.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : !targets.data?.length ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              You have no upcoming tournament with a final that hasn't been drawn yet. Create one first, with at least one invite slot in its final stage.
            </p>
          ) : (
            <RadioGroup value={pick} onValueChange={setPick} className="gap-2">
              {targets.data.map((x) => (
                <Label
                  key={x.id}
                  htmlFor={`ft-${x.id}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <RadioGroupItem id={`ft-${x.id}`} value={x.id} disabled={x.invitesLeft <= 0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{x.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {x.stageName}
                      {x.startDate ? ` · ${formatDate(x.startDate)}` : ""} ·{" "}
                      {x.invitesLeft > 0 ? `${x.invitesLeft} invite slot${x.invitesLeft === 1 ? "" : "s"} left` : "no invite slots left"}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!usable.some((x) => x.id === pick) || give.isPending}
              onClick={() => give.mutate({ week: board.week.start, tournamentId: pick }, { onSuccess: () => setOpen(false) })}
            >
              {give.isPending ? <Loader2 className="animate-spin" /> : <Trophy />} Give Finals Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A scrim's Weekly Board for its organiser: /manager/scrims/:scrimId/weekly?week= */
export default function ManagerWeeklyBoardPage() {
  usePageTour("manager.weekly", TOUR);
  const { scrimId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const week = params.get("week") ?? "";
  const q = useManagerWeekly(scrimId, week);
  const b = q.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={`/manager/scrims/${scrimId}`}>
          <ArrowLeft /> Back to scrim
        </Link>
      </Button>
      <PageHeader eyebrow="Weekly Board" title={b?.scrim.title ?? "Weekly Board"} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load the Weekly Board" />
      ) : !b ? (
        <StandingsSkeleton />
      ) : (
        <WeeklyBoardView
          board={b}
          fetching={q.isPlaceholderData}
          onWeek={(w) => setParams(w ? { week: w } : {}, { replace: true })}
          leaderAction={<GiveFinalsSlot board={b} scrimId={scrimId} week={week} />}
          nightHref={(_, date) => `/manager/scrims/${scrimId}/${date}/standings`}
        />
      )}
    </>
  );
}

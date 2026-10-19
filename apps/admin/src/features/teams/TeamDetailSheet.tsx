import { useState } from "react";
import { AlertTriangle, CalendarClock, Crown, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { MAX_TEAM_MEMBERS, type AdminTeamDetail } from "@7xen/shared";
import { Pill, TeamAvatar } from "@7xen/ui/components/brand/status";
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
import { ScrollArea } from "@7xen/ui/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@7xen/ui/components/ui/sheet";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { PlayerAvatar, playerName } from "@/components/PlayerAvatar";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";
import { useDisbandTeam, useTeamDetail } from "./api";

/** Right-hand sheet (full width on phones): leader, members and the "Disband team" action. */
export function TeamDetailSheet({ teamId, onClose }: { teamId: string | null; onClose: () => void }) {
  const detail = useTeamDetail(teamId);
  const [confirming, setConfirming] = useState(false);
  const t = detail.data;

  return (
    <Sheet open={!!teamId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" data-tour="team-detail">
        <SheetHeader className="border-b p-5 pr-12">
          {t ? (
            <div className="flex items-center gap-3">
              <TeamAvatar name={t.name} tag={t.tag} size="lg" />
              <div className="min-w-0">
                <SheetTitle className="truncate font-display text-2xl">{t.name}</SheetTitle>
                <SheetDescription>
                  <span className="font-semibold tracking-wider text-primary">[{t.tag}]</span> · created {shortDate(t.createdAt)}
                </SheetDescription>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Skeleton className="size-14 rounded-xl" />
              <div className="flex-1 space-y-2">
                <SheetTitle className="sr-only">Team</SheetTitle>
                <SheetDescription className="sr-only">Loading team details</SheetDescription>
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {detail.isPending ? (
              <DetailSkeleton />
            ) : detail.isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="mb-3">Couldn't load this team. {errorMessage(detail.error)}</p>
                <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
                  <RefreshCw /> Try again
                </Button>
              </div>
            ) : (
              t && <DetailBody t={t} />
            )}
          </div>
        </ScrollArea>

        {t && (
          <SheetFooter className="border-t p-5">
            <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirming(true)} data-tour="disband">
              <Trash2 /> Disband team
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
      <DisbandDialog team={confirming ? (t ?? null) : null} onClose={() => setConfirming(false)} onDone={onClose} />
    </Sheet>
  );
}

function DetailBody({ t }: { t: AdminTeamDetail }) {
  const members = [...t.members].sort((a, b) => (a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "LEADER" ? -1 : 1));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Users className="size-3.5" /> Members
          </div>
          <div className="mt-1 font-display text-3xl leading-none font-bold">
            {t.members.length}
            <span className="ml-1 text-base font-semibold text-muted-foreground">/ {MAX_TEAM_MEMBERS}</span>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarClock className="size-3.5" /> Upcoming scrims
          </div>
          <div className="mt-1 font-display text-3xl leading-none font-bold">{t.upcomingRegistrations}</div>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Leader</h3>
        {t.leader ? (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <PlayerAvatar player={t.leader} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{playerName(t.leader)}</div>
              {t.leader.ign && t.leader.ign !== t.leader.displayName && <div className="truncate text-xs text-muted-foreground">{t.leader.displayName}</div>}
            </div>
            <Crown className="size-5 text-warning" aria-label="Leader" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No leader.</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Members ({t.members.length})</h3>
        {members.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-3">
                <PlayerAvatar player={m} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{playerName(m)}</span>
                    {m.role === "LEADER" && (
                      <Pill tone="warning" icon={<Crown className="size-3" />}>
                        Leader
                      </Pill>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    BGMI ID <span className="font-mono text-foreground">{m.bgmiId ?? "—"}</span> · joined {relativeTime(m.joinedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No members yet.</p>
        )}
      </section>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[74px] rounded-xl" />
        <Skeleton className="h-[74px] rounded-xl" />
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DisbandDialog({ team, onClose, onDone }: { team: AdminTeamDetail | null; onClose: () => void; onDone: () => void }) {
  const disband = useDisbandTeam();
  const [error, setError] = useState<string | null>(null);
  const busy = disband.isPending;
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  return (
    <AlertDialog open={!!team} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">Disband {team?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The team is deleted for good. Its {team?.members.length ?? 0} {team?.members.length === 1 ? "player keeps their account" : "players keep their accounts"} and can create or join another team.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!!team?.upcomingRegistrations && !error && (
          <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/15 p-3 text-sm text-warning-foreground dark:text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            This team is registered for {team.upcomingRegistrations} upcoming {team.upcomingRegistrations === 1 ? "scrim" : "scrims"}. Those need to be cancelled first.
          </p>
        )}
        {error && (
          <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!team) return;
              setError(null);
              try {
                await disband.mutateAsync(team.id);
                toast.success(`${team.name} was disbanded`);
                onClose();
                onDone();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {busy ? "Disbanding…" : "Disband team"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

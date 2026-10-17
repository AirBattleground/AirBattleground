import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Ban, CalendarClock, Loader2, MoveRight } from "lucide-react";
import { disqualifySchema, type GroupDetail, type GroupMatchRow, type GroupStandingRow, type StageDetail } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { MAP_LABELS } from "@7xen/shared";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { slot2 } from "@/features/tournaments/shared/format";
import { useDisqualify, useGroupMoves, useRescheduleMatch } from "../api";
import { istIso, istParts } from "../format";
import { TimePick } from "./ScheduleEditor";

type Located = GroupStandingRow & { group: GroupDetail };

function useTeams(stage: StageDetail): Located[] {
  return useMemo(() => stage.groups.flatMap((g) => g.teams.map((t) => ({ ...t, group: g }))), [stage.groups]);
}

function TeamSelect({ stage, value, onChange, label, exclude }: { stage: StageDetail; value: string; onChange: (v: string) => void; label: string; exclude?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-10 w-full">
        <SelectValue placeholder="Pick a team" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {stage.groups.map((g) => (
          <SelectGroup key={g.id}>
            <SelectLabel>Group {g.name}</SelectLabel>
            {[...g.teams]
              .sort((a, b) => a.slotNumber - b.slotNumber)
              .filter((t) => t.team.id !== exclude && t.status !== "DISQUALIFIED")
              .map((t) => (
                <SelectItem key={t.team.id} value={t.team.id}>
                  {slot2(t.slotNumber)} · {t.team.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Move a team to another group, or swap two teams (keeps their slot numbers sensible). */
export function MoveTeamDialog({ stage, open, onOpenChange }: { stage: StageDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const teams = useTeams(stage);
  const moves = useGroupMoves(stage.tournament.id, stage.stage.id);
  const [mode, setMode] = useState<"move" | "swap">("swap");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [toGroup, setToGroup] = useState("");
  useEffect(() => {
    if (open) {
      setA("");
      setB("");
      setToGroup("");
    }
  }, [open]);
  const ta = teams.find((t) => t.team.id === a);
  const tb = teams.find((t) => t.team.id === b);
  const target = stage.groups.find((g) => g.id === toGroup);
  const full = target ? target.teams.length >= stage.stage.lobbySize : false;
  const ready = mode === "swap" ? !!ta && !!tb && ta.group.id !== tb.group.id : !!ta && !!target && target.id !== ta.group.id && !full;

  const submit = () => {
    if (!ta) return;
    const input =
      mode === "swap" && tb
        ? { moves: [{ teamId: ta.team.id, toGroupId: tb.group.id, slotNumber: tb.slotNumber }, { teamId: tb.team.id, toGroupId: ta.group.id, slotNumber: ta.slotNumber }] }
        : { moves: [{ teamId: ta.team.id, toGroupId: toGroup }] };
    moves.mutate(input, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <ArrowLeftRight className="size-5 text-primary" /> Change groups
          </DialogTitle>
          <DialogDescription>Fix a clash or balance the groups. Only possible before any results are entered.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "move" | "swap")} className="w-full">
            <ToggleGroupItem value="swap" className="flex-1">
              <ArrowLeftRight /> Swap two teams
            </ToggleGroupItem>
            <ToggleGroupItem value="move" className="flex-1">
              <MoveRight /> Move one team
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="space-y-2">
            <Label>Team</Label>
            <TeamSelect stage={stage} value={a} onChange={setA} label="Team to move" />
          </div>
          {mode === "swap" ? (
            <div className="space-y-2">
              <Label>Swap with</Label>
              <TeamSelect stage={stage} value={b} onChange={setB} label="Swap with" exclude={a} />
              {ta && tb && ta.group.id === tb.group.id && <p className="text-xs text-destructive">Pick a team from a different group.</p>}
              {ta && tb && ta.group.id !== tb.group.id && (
                <p className="text-sm text-muted-foreground">
                  {ta.team.name} → Group {tb.group.name} ({slot2(tb.slotNumber)}) · {tb.team.name} → Group {ta.group.name} ({slot2(ta.slotNumber)})
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Move to</Label>
              <Select value={toGroup} onValueChange={setToGroup}>
                <SelectTrigger aria-label="Target group" className="h-10 w-full">
                  <SelectValue placeholder="Pick a group" />
                </SelectTrigger>
                <SelectContent>
                  {stage.groups
                    .filter((g) => g.id !== ta?.group.id)
                    .map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        Group {g.name} · {g.teams.length}/{stage.stage.lobbySize}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {full && <p className="text-xs text-destructive">That group is full — swap instead.</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || moves.isPending} onClick={submit}>
            {moves.isPending && <Loader2 className="animate-spin" />} {mode === "swap" ? "Swap teams" : "Move team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Disqualify a team from this stage (with a reason teams can read). */
export function DisqualifyDialog({ stage, open, onOpenChange, initialTeamId }: { stage: StageDetail; open: boolean; onOpenChange: (o: boolean) => void; initialTeamId?: string }) {
  const teams = useTeams(stage);
  const dq = useDisqualify(stage.tournament.id, stage.stage.id);
  const [teamId, setTeamId] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setTeamId(initialTeamId ?? "");
      setReason("");
    }
  }, [open, initialTeamId]);
  const team = teams.find((t) => t.team.id === teamId);
  const valid = disqualifySchema.safeParse({ reason }).success;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Ban className="size-5 text-destructive" /> Disqualify a team
          </DialogTitle>
          <DialogDescription>The team can't advance from this stage. Their past results stay in the table.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team</Label>
            <TeamSelect stage={stage} value={teamId} onChange={setTeamId} label="Team to disqualify" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dq-reason">Reason</Label>
            <Textarea id="dq-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Teaming with another squad in match 3" maxLength={300} />
            <p className="text-xs text-muted-foreground">Shown to the team. At least 3 characters.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!team || !valid || dq.isPending} onClick={() => team && dq.mutate({ team: team.team, reason: reason.trim() }, { onSuccess: () => onOpenChange(false) })}>
            {dq.isPending && <Loader2 className="animate-spin" />} Disqualify {team?.team.name ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move one match to a new date/time (IST). */
export function RescheduleMatchDialog({ stage, match, group, onOpenChange }: { stage: StageDetail; match: GroupMatchRow | null; group: GroupDetail | null; onOpenChange: (o: boolean) => void }) {
  const resched = useRescheduleMatch(stage.tournament.id);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  useEffect(() => {
    if (match) {
      const p = match.scheduledAt ? istParts(match.scheduledAt) : null;
      setDate(p?.date ?? stage.stage.schedule?.startDate ?? "");
      setTime(p?.time ?? "18:00");
    }
  }, [match, stage.stage.schedule?.startDate]);
  return (
    <Dialog open={!!match} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <CalendarClock className="size-5 text-primary" /> Reschedule match
          </DialogTitle>
          <DialogDescription>
            {group && match ? `Group ${group.name} · Match ${match.number} · ${MAP_LABELS[match.map as keyof typeof MAP_LABELS] ?? match.map}` : ""}. Teams see the new time straight away.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DatePickerButton value={date || null} onChange={setDate} className="h-10" />
          <TimePick value={time} onChange={setTime} label="Match time" />
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">IST</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!date || !match || resched.isPending}
            onClick={() => match && resched.mutate({ matchId: match.id, scheduledAt: istIso(date, time) }, { onSuccess: () => onOpenChange(false) })}
          >
            {resched.isPending && <Loader2 className="animate-spin" />} Save new time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

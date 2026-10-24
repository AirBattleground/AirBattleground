import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { DoorOpen, Eye, EyeOff, KeyRound, MessageCircle, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { ApiError, MAP_LABELS, saveRoomSchema, type GameMap, type RoomDetails, type SaveRoomInput } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { errorMessage } from "@/features/manager/api";
import { useNow } from "@/features/manager/components/useNow";
import { useDeleteRoom, useRoom, useSaveRoom } from "../api";
import { fmtClock } from "../format";
import { CopyButton } from "./CopyButton";

type FormIn = z.input<typeof saveRoomSchema>;
const REVEAL_OPTIONS: { value: string; label: string }[] = [
  { value: "now", label: "Right now" },
  { value: "5", label: "5 min before start" },
  { value: "10", label: "10 min before start" },
  { value: "15", label: "15 min before start" },
  { value: "20", label: "20 min before start" },
  { value: "30", label: "30 min before start" },
  { value: "45", label: "45 min before start" },
  { value: "60", label: "1 hour before start" },
];

export interface MatchLabel {
  title: string;
  number: number;
  map: GameMap;
  /** the scrim's planned IDP for this match: the default "show teams" time */
  idpMinutes?: number | null;
}

/** Message the manager pastes into the WhatsApp group. */
export function roomMessage(label: MatchLabel, room: RoomDetails): string {
  return [`*${label.title} — Match ${label.number} (${MAP_LABELS[label.map]})*`, "", `Room ID: ${room.roomId}`, `Password: ${room.password}`, "", "Join with your registered slot. GLHF!"].join("\n");
}

/** Room ID / password of a match: show + copy, WhatsApp text, edit / remove. */
export function RoomCard({ matchId, label, readOnly = false }: { matchId: string; label: MatchLabel; readOnly?: boolean }) {
  const q = useRoom(matchId);
  const del = useDeleteRoom(matchId);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const now = useNow(30_000);
  const room = q.data ?? null;

  const revealMs = room?.revealAt ? new Date(room.revealAt).getTime() : null;
  const visible = !room?.revealAt || (revealMs != null && revealMs <= now);

  return (
    <section data-tour="room-card" aria-labelledby="room-card-title" className="relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="relative mb-3 flex items-center gap-2">
        <DoorOpen className="size-4 text-primary" />
        <h2 id="room-card-title" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Room
        </h2>
        {room && (
          <Pill tone={visible ? "success" : "warning"} className="ml-auto">
            {visible ? "Teams can see it" : "Hidden from teams"}
          </Pill>
        )}
      </div>

      {q.isPending ? (
        <div className="relative space-y-3">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </div>
      ) : !room ? (
        <div className="relative flex flex-1 flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">No room yet. Add the room ID and password — teams see them at the time you choose.</p>
          {!readOnly && (
            <Button onClick={() => setEditing(true)} data-tour="room-edit">
              <Plus /> Add room details
            </Button>
          )}
        </div>
      ) : (
        <div className="relative space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-lg border bg-background/60 p-2.5 pl-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Room ID</div>
                <div className="truncate font-display text-2xl leading-tight font-bold tracking-wider">{room.roomId}</div>
              </div>
              <CopyButton value={room.roomId} label="Copy room ID" />
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-background/60 p-2.5 pl-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Password</div>
                <div className={cn("truncate font-display text-2xl leading-tight font-bold tracking-wider", !show && "text-muted-foreground")}>
                  {show ? room.password : "•".repeat(Math.min(8, Math.max(4, room.password.length)))}
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
                {show ? <EyeOff /> : <Eye />}
              </Button>
              <CopyButton value={room.password} label="Copy password" />
            </div>
          </div>
          {room.revealAt && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <KeyRound className="size-4 shrink-0" />
              {visible ? `Visible since ${fmtClock(room.revealAt)}` : `Teams see it at ${fmtClock(room.revealAt)}`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <CopyButton value={roomMessage(label, room)} variant="default" toastText="Copied — paste it in your WhatsApp group" data-tour="room-whatsapp">
              <MessageCircle /> Copy for WhatsApp
            </CopyButton>
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-tour="room-edit">
                  <Pencil /> Edit
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setRemoving(true)} disabled={del.isPending}>
                  <Trash2 /> Remove
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {editing && <RoomDialog matchId={matchId} room={room} idpMinutes={label.idpMinutes} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the room details?"
        description="Teams won't see a room ID or password for this match until you add them again."
        confirmLabel="Remove"
        destructive
        onConfirm={() => del.mutate()}
      />
    </section>
  );
}

function RoomDialog({ matchId, room, idpMinutes, onClose }: { matchId: string; room: RoomDetails | null; idpMinutes?: number | null; onClose: () => void }) {
  const save = useSaveRoom(matchId);
  const form = useForm<FormIn, unknown, SaveRoomInput>({
    resolver: zodResolver(saveRoomSchema),
    defaultValues: { roomId: room?.roomId ?? "", password: room?.password ?? "", revealMinutesBefore: room && !room.revealAt ? null : (idpMinutes ?? 15) },
  });
  const { register, handleSubmit, control, formState, setError } = form;

  const onSubmit = handleSubmit((input) =>
    save.mutate(input, {
      onSuccess: onClose,
      onError: (err) => {
        if (err instanceof ApiError && err.fields) {
          for (const [k, message] of Object.entries(err.fields)) if (k === "roomId" || k === "password" || k === "revealMinutesBefore") setError(k, { message });
          return;
        }
        toast.error("Couldn't save the room", { description: errorMessage(err) });
      },
    }),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{room ? "Edit room details" : "Add room details"}</DialogTitle>
          <DialogDescription>Teams in this match see these on their dashboard.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="room-id">Room ID</Label>
              <Input id="room-id" inputMode="numeric" autoComplete="off" placeholder="e.g. 4829301" className="h-11 font-display text-lg font-bold tracking-wider" aria-invalid={!!formState.errors.roomId || undefined} {...register("roomId")} autoFocus />
              {formState.errors.roomId && <p className="text-xs text-destructive">{formState.errors.roomId.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-pass">Password</Label>
              <Input id="room-pass" autoComplete="off" placeholder="e.g. AirBattleground" className="h-11 font-display text-lg font-bold tracking-wider" aria-invalid={!!formState.errors.password || undefined} {...register("password")} />
              {formState.errors.password && <p className="text-xs text-destructive">{formState.errors.password.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-reveal">Show it to teams</Label>
            <Controller
              control={control}
              name="revealMinutesBefore"
              render={({ field }) => (
                <Select value={field.value == null ? "now" : String(field.value)} onValueChange={(v) => field.onChange(v === "now" ? null : Number(v))}>
                  <SelectTrigger id="room-reveal" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVEAL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                    {field.value != null && !REVEAL_OPTIONS.some((o) => o.value === String(field.value)) && <SelectItem value={String(field.value)}>{field.value} min before start</SelectItem>}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Smartphone className="size-3.5" /> Until then teams see when it will appear.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

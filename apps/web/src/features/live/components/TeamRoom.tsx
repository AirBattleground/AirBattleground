import { useEffect } from "react";
import { motion } from "framer-motion";
import { Clock, DoorOpen, Lock } from "lucide-react";
import type { TeamRoomCard } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { useTeamRooms } from "../api";
import { fmtClock } from "../format";
import { CopyButton } from "./CopyButton";

const PAST_MS = 90 * 60_000;

/** Upcoming cards, soonest first (matches that started up to 90 min ago still count — the room is still useful). */
function upcoming(items: TeamRoomCard[] | undefined): TeamRoomCard[] {
  const now = Date.now();
  return [...(items ?? [])]
    .filter((c) => !c.startsAt || new Date(c.startsAt).getTime() > now - PAST_MS)
    .sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999"));
}

/** Team rooms query that also refetches the moment a room is due to be revealed. */
function useRooms() {
  const q = useTeamRooms();
  const { refetch } = q;
  const nextReveal = (q.data ?? [])
    .filter((c) => !c.room && c.revealAt)
    .map((c) => new Date(c.revealAt!).getTime())
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!nextReveal) return;
    const ms = nextReveal - Date.now() + 1500;
    if (ms > 2 ** 31 - 1) return;
    const t = setTimeout(() => void refetch(), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [nextReveal, refetch]);
  return q;
}

/** Room ID + password with copy buttons once revealed, otherwise when they'll appear. */
export function TeamRoomBox({ card, className }: { card: TeamRoomCard; className?: string }) {
  if (card.room) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("grid gap-2 sm:grid-cols-2", className)}
        data-tour="room-details"
      >
        {(
          [
            ["Room ID", card.room.roomId],
            ["Password", card.room.password],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 pl-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-wider text-primary uppercase">{label}</div>
              <div className="truncate font-display text-2xl leading-tight font-bold tracking-wider select-all">{value}</div>
            </div>
            <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
          </div>
        ))}
      </motion.div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg border border-dashed bg-background/60 p-3 text-sm", className)} data-tour="room-details">
      <Lock className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {card.revealAt ? (
          <>
            Room details appear at <span className="font-semibold text-foreground">{fmtClock(card.revealAt)}</span>
          </>
        ) : (
          "Room ID and password show up here once the organiser creates the room."
        )}
      </span>
    </div>
  );
}

/** Room for one match (e.g. the tournament "Next match"). Renders nothing if the API doesn't list it. */
export function MatchRoom({ matchId, className }: { matchId: string; className?: string }) {
  const q = useRooms();
  const card = q.data?.find((c) => c.matchId === matchId);
  if (!card) return null;
  return <TeamRoomBox card={card} className={className} />;
}

/** Team dashboard: the next match's room (ID / password or when they'll appear). Hidden when nothing is coming up. */
export function NextRoomCard() {
  const q = useRooms();
  const list = upcoming(q.data);
  const next = list[0];
  if (!next) return null;
  const more = list.slice(1, 4);
  return (
    <section
      aria-labelledby="next-room-title"
      data-tour="next-room"
      className={cn("relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:p-5", next.room && "border-primary/40 shadow-glow")}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="relative flex items-start gap-3">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", next.room ? "bg-primary text-primary-foreground shadow-glow" : "bg-primary/15 text-primary")}>
          <DoorOpen className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">{next.room ? "Room is ready" : "Your next room"}</p>
          <h2 id="next-room-title" className="truncate font-display text-xl leading-tight font-bold sm:text-2xl">
            {next.subtitle ? next.title : `${next.title} · Match ${next.number}`}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <MapChip map={next.map} className="px-1.5 py-0.5 text-[11px]" />
            {next.startsAt && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> {fmtClock(next.startsAt)}
              </span>
            )}
            {next.subtitle && <span className="truncate">{next.subtitle}</span>}
          </p>
        </div>
        {next.slotNumber != null && <SlotChip slot={next.slotNumber} className="hidden shrink-0 sm:inline-flex" />}
      </div>
      <TeamRoomBox card={next} className="relative mt-3" />
      {more.length > 0 && (
        <ul className="relative mt-3 divide-y rounded-lg border bg-background/60 text-sm">
          {more.map((c) => (
            <li key={c.matchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">
                {c.title} · Match {c.number}
              </span>
              <span className="text-muted-foreground">{c.startsAt ? fmtClock(c.startsAt) : "Time TBA"}</span>
              {c.room ? (
                <span className="font-display font-bold tracking-wider">
                  {c.room.roomId} / {c.room.password}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{c.revealAt ? `Room at ${fmtClock(c.revealAt)}` : "Room not shared yet"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

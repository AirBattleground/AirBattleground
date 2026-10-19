import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CalendarDays, Megaphone, Swords, Trophy, UserPlus, X } from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import type { TeamSuggestionRow } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { useRegister } from "@/features/team/api";
import { RegisterDialog } from "@/features/team/components/ConfirmDialogs";
import { formatDate, formatTime } from "@/features/team/format";
import { SectionHeader } from "@/features/team/home/SectionHeader";
import { useDismissSuggestion, useTeamSuggestions } from "../api";
import { PlayerAvatar } from "./PlayerAvatar";

function Poster({ url, kind }: { url: string | null; kind: TeamSuggestionRow["kind"] }) {
  const [failed, setFailed] = useState(false);
  const Icon = kind === "SCRIM" ? Swords : Trophy;
  if (url && !failed) return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="size-20 shrink-0 rounded-xl object-cover ring-1 ring-border sm:size-24" />;
  return (
    <span className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 sm:size-24">
      <span aria-hidden className="absolute inset-0 bg-grid opacity-60" />
      <Icon className="relative size-8" />
    </span>
  );
}

function SuggestionCard({ s }: { s: TeamSuggestionRow }) {
  const dismiss = useDismissSuggestion();
  const register = useRegister();
  const [confirm, setConfirm] = useState(false);
  const who = s.from.ign ?? s.from.displayName;
  const ago = formatDistanceToNowStrict(parseISO(s.createdAt), { addSuffix: true });
  const title = s.scrim?.title ?? s.tournament?.name ?? "Unknown";
  const organiser = s.scrim?.organiser ?? s.tournament?.organiser ?? "";
  const poster = s.scrim?.posterUrl ?? s.tournament?.posterUrl ?? null;

  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-3.5 shadow-sm sm:flex-row sm:items-center sm:p-4">
      <div className="flex min-w-0 flex-1 gap-3.5">
        <Poster url={poster} kind={s.kind} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-primary uppercase">
            {s.kind === "SCRIM" ? <Swords className="size-3.5" /> : <Trophy className="size-3.5" />}
            {s.kind === "SCRIM" ? "Scrim" : "Tournament"}
            {organiser && <span className="truncate font-semibold tracking-normal text-muted-foreground normal-case">· {organiser}</span>}
          </p>
          <h3 className="mt-0.5 line-clamp-2 font-display text-xl leading-tight font-bold uppercase">{title}</h3>
          {s.scrim && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays className="size-4 text-primary" /> {formatDate(s.scrim.date, "EEE, d MMM")} · {formatTime(s.scrim.startTime)} IST
            </p>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PlayerAvatar name={who} url={s.from.avatarUrl} size="sm" className="size-5 rounded-md text-[8px]" />
            <span className="truncate">
              <span className="font-semibold text-foreground">{who}</span> asked {ago}
              {s.note ? ` · “${s.note}”` : ""}
            </span>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:flex-col">
        {s.kind === "SCRIM" && s.scrim ? (
          <Button className="flex-1 shadow-glow" onClick={() => setConfirm(true)} disabled={register.isPending}>
            <UserPlus /> Register
          </Button>
        ) : s.tournament ? (
          <Button asChild className="flex-1 shadow-glow">
            <Link to={`/team/tournaments/${s.tournament.id}`}>
              Register <ArrowRight />
            </Link>
          </Button>
        ) : null}
        <Button variant="ghost" className="text-muted-foreground" onClick={() => dismiss.mutate(s.id)} disabled={dismiss.isPending}>
          <X /> Dismiss
        </Button>
      </div>
      {s.scrim && (
        <RegisterDialog
          open={confirm}
          onOpenChange={setConfirm}
          summary={{ title: s.scrim.title, date: s.scrim.date, startTime: s.scrim.startTime, organiser: s.scrim.organiser, maps: [] }}
          full={false}
          onConfirm={() => register.mutate({ scrimId: s.scrim!.id, date: s.scrim!.date })}
        />
      )}
    </motion.li>
  );
}

/** Leader's home: what the squad asked to play, with one-tap Register / Dismiss. Hidden when there's nothing. */
export function SuggestionsPanel({ className }: { className?: string }) {
  const q = useTeamSuggestions("OPEN");
  const items = q.data ?? [];
  if (q.isLoading) {
    return (
      <section className={cn("space-y-4", className)}>
        <div className="h-10 w-56 animate-pulse rounded-lg bg-muted" />
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      </section>
    );
  }
  if (items.length === 0) return null;
  return (
    <section className={cn("space-y-4", className)} data-tour="team-suggestions">
      <SectionHeader
        eyebrow="Your squad wants to play"
        title={
          <>
            Asked by your team
            <span className="ml-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 font-display text-base leading-none text-primary-foreground shadow-glow">{items.length}</span>
          </>
        }
        icon={<Megaphone />}
      />
      <ul className="grid gap-3 lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <SuggestionCard key={s.id} s={s} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

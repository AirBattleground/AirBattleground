import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crosshair, Trophy } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { useTeamTournament, useTeamTournaments } from "../api";
import { meChip } from "../journey";
import { StatusPill } from "../../shared/StatusPill";
import { fmtDay } from "../../shared/format";

const FINISHED = new Set<TournamentSummary["status"]>(["COMPLETED", "CANCELLED"]);

function EntryRow({ t }: { t: TournamentSummary }) {
  const d = useTeamTournament(t.id);
  const chip = d.data ? meChip(d.data.me) : null;
  const tdm = t.mode === "TDM";
  return (
    <Link
      to={`/team/tournaments/${t.id}`}
      className="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm outline-none transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-4"
    >
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", tdm ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
        {tdm ? <Crosshair /> : <Trophy />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-display text-lg leading-tight font-bold group-hover:text-primary">{t.title}</span>
          <span className="shrink-0 rounded-md border px-1.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{tdm ? "TDM" : "Tournament"}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <StatusPill status={t.status} />
          {chip && (
            <Pill tone={chip.tone} className="font-bold">
              {chip.text}
            </Pill>
          )}
          {t.startsAt && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" /> {fmtDay(t.startsAt)}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** My registrations: the team's tournament + TDM battle entries (upcoming = not finished; past = finished). */
export function MyEntriesList({ scope }: { scope: "upcoming" | "past" }) {
  const q = useTeamTournaments("mine");
  if (q.isLoading) return <Skeleton className="h-20 rounded-xl" />;
  const items = (q.data ?? []).filter((t) => FINISHED.has(t.status) === (scope === "past"));
  if (!items.length) return null;
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-baseline gap-2 font-display text-lg font-bold">
        Tournaments &amp; TDM battles
        <span className="ml-auto text-xs font-medium text-muted-foreground">{items.length}</span>
      </h3>
      <div className="space-y-2.5">
        {items.map((t) => (
          <EntryRow key={t.id} t={t} />
        ))}
      </div>
    </section>
  );
}

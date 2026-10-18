import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, Trophy } from "lucide-react";
import type { TournamentSummary } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { Countdown } from "../../shared/Countdown";
import { RegistrationMeter } from "../../shared/RegistrationMeter";
import { fmtWhen } from "../../shared/format";
import { useTeamTournament, useTeamTournaments } from "../api";
import { journeyCopy, meChip } from "../journey";

const ACTIVE = new Set(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"]);

/** Poster as the card's icon tile; falls back to the trophy tile when missing/broken. */
function Tile({ poster, title }: { poster: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (poster && !failed)
    return (
      <span className="relative size-12 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-border sm:size-14">
        <img src={poster} alt={`${title} poster`} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
      </span>
    );
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-warning/15 text-warning-foreground dark:text-warning">
      <Trophy className="size-6" />
    </span>
  );
}

function Shell({ to, children, highlight, t }: { to: string; children: ReactNode; highlight?: boolean; t: TournamentSummary }) {
  return (
    <Link
      to={to}
      data-tour="home-tournaments"
      className={cn(
        // phones: icon beside the text like the other dashboard cards, action full-width underneath
        "group relative grid grid-cols-[3rem_1fr] items-start gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex sm:items-center sm:p-6",
        highlight && "border-primary/40",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <Tile poster={t.posterUrl} title={t.title} />
      {children}
      <ArrowRight className="relative hidden size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary sm:block" />
    </Link>
  );
}

function MineSummary({ t }: { t: TournamentSummary }) {
  const d = useTeamTournament(t.id).data;
  const chip = d ? meChip(d.me) : null;
  const nm = d?.me.nextMatch;
  return (
    <Shell to={`/team/tournaments/${t.id}`} t={t} highlight>
      <div className="relative min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
          Your tournament {chip && <Pill tone={chip.tone} className="tracking-normal normal-case">{chip.text}</Pill>}
        </p>
        <p className="truncate font-display text-xl leading-tight font-bold">{t.title}</p>
        <p className="text-sm text-muted-foreground">
          {nm ? (
            <>
              Next: Match {nm.number} · Group {nm.groupName} · {fmtWhen(nm.scheduledAt)}
            </>
          ) : d ? (
            (d.me.nextGoal ?? journeyCopy(d).body)
          ) : (
            "Loading your status…"
          )}
        </p>
      </div>
      {nm?.scheduledAt && (
        <div className="relative col-span-2 shrink-0 text-left sm:text-right">
          <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Starts in</p>
          <p className="flex items-center gap-1 font-display text-2xl font-bold">
            <Clock className="size-4 text-primary" />
            <Countdown to={nm.scheduledAt} doneText="Now!" />
          </p>
        </div>
      )}
    </Shell>
  );
}

/** Compact dashboard card: your next tournament match, or an open tournament to join. Renders nothing if neither. */
export function TournamentsHomeCard() {
  const mine = useTeamTournaments("mine");
  const open = useTeamTournaments("open");
  const active = (mine.data ?? []).find((t) => ACTIVE.has(t.status));
  if (active) return <MineSummary t={active} />;
  const mineIds = new Set((mine.data ?? []).map((t) => t.id));
  const join = (open.data ?? []).find((t) => !mineIds.has(t.id));
  if (!join) return null;
  return (
    <Shell to={`/team/tournaments/${join.id}`} t={join}>
      <div className="relative min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Tournament · registration open</p>
        <p className="truncate font-display text-xl leading-tight font-bold">
          {join.title}
          {join.prize && <span className="ml-2 text-base text-warning-foreground dark:text-warning">· {join.prize}</span>}
        </p>
        <RegistrationMeter confirmed={join.confirmedCount} max={join.maxTeams} waitlist={join.waitlistCount} size="sm" className="mt-2" />
      </div>
      <span className="relative col-span-2 inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-glow sm:ml-2">
        View & register
      </span>
    </Shell>
  );
}

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarCheck, CalendarDays, Crosshair, Hourglass, Medal, Search, Ticket, Trophy } from "lucide-react";
import type { TeamDashboard, TeamRegistration, TeamSummary } from "@7xen/shared";
import { SlotChip, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { OrganizerBadge } from "../components/Branding";
import { CountdownBlocks } from "../components/Countdown";
import { MapChips } from "../components/MapChips";
import { formatDate, whenLabel } from "../format";

/** Poster art behind the hero: right half on desktop, top on phones, feathered into the card. */
function Backdrop({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  const has = !!url && !failed;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* brand light */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_100%_100%,color-mix(in_oklch,var(--brand-400)_18%,transparent),transparent_65%)]" />
      {has && (
        <div className="home-hero-art absolute inset-y-0 right-0 w-full md:w-[62%]">
          <img src={url!} alt="" decoding="async" onError={() => setFailed(true)} className="home-drift size-full object-cover object-center opacity-45 saturate-125 dark:opacity-55" />
          <div className="tc-scan absolute inset-0 opacity-50" />
        </div>
      )}
      {/* giant mark watermark */}
      <img
        src={markUrl}
        alt=""
        className={cn(
          "brand-ink absolute -right-16 -bottom-24 w-[26rem] max-w-none rotate-[-12deg] opacity-[0.07] sm:w-[34rem] dark:opacity-[0.1]",
          has && "md:opacity-0 dark:md:opacity-0",
        )}
      />
      <div className="absolute inset-0 bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,#000,transparent_85%)]" />
      <div className="absolute -top-32 -left-24 size-96 rounded-full bg-primary/25 blur-3xl animate-aurora" />
      <div className="absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-brand-500/15 blur-3xl animate-aurora [animation-delay:-8s]" />
      {/* bottom hairline glow */}
      <div className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
    </div>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center sm:h-8", className)}>
      <img src={wordmarkInkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink h-full w-auto dark:hidden" />
      <img src={wordmarkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink hidden h-full w-auto dark:block" />
    </span>
  );
}

/** Glass panel showing the next approved match with a live countdown (or an inviting empty state). */
function NextMatchPanel({ match, today, loading }: { match: TeamRegistration | null; today: string; loading: boolean }) {
  const glass = "relative overflow-hidden rounded-2xl border border-primary/25 bg-background/65 p-4 shadow-lg backdrop-blur-xl sm:p-5";
  if (loading) {
    return (
      <div className={glass} data-tour="next-match">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-8 w-3/4 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-5 h-16 w-56 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!match) {
    return (
      <div className={glass} data-tour="next-match">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Crosshair className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.25em] text-primary uppercase">Your next match</p>
            <h2 className="mt-1 font-display text-2xl leading-tight font-bold">No match booked yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Register for a scrim below. Once the organiser approves you, your slot and a countdown show up right here.</p>
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-muted-foreground">
          {["Pick a scrim", "Register", "Get your slot"].map((s, i) => (
            <li key={s} className="rounded-lg border bg-card/70 px-1.5 py-2">
              <span className="block font-display text-lg leading-none font-bold text-primary">{i + 1}</span>
              <span className="mt-1 block leading-tight">{s}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className={cn(glass, "border-primary/40 shadow-glow")} data-tour="next-match">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-primary uppercase">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Your next match
          </p>
          <h2 className="mt-1 line-clamp-2 font-display text-2xl leading-tight font-bold sm:text-3xl">{match.scrim.title}</h2>
        </div>
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15 }} data-tour="next-slot">
          {match.slotNumber != null ? (
            <div className="flex flex-col items-center">
              <SlotChip slot={match.slotNumber} size="lg" className="h-16 min-w-20 text-3xl sm:h-20 sm:min-w-24 sm:text-4xl" />
              <span className="mt-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Your slot</span>
            </div>
          ) : (
            <span className="inline-flex h-12 items-center rounded-xl border border-success/40 bg-success/10 px-3 font-display font-bold text-success">Approved</span>
          )}
        </motion.div>
      </div>
      <div className="relative mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 font-semibold">
          <CalendarDays className="size-4 text-primary" /> {whenLabel(match.date, match.scrim.startTime, today)}
        </span>
        <OrganizerBadge manager={match.scrim.manager} prefix="by" className="text-muted-foreground" iconClassName="size-4" logoClassName="size-6" />
      </div>
      <MapChips maps={match.scrim.maps} className="relative mt-3" />
      <div className="relative mt-4 border-t pt-3">
        <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Starts in</p>
        <CountdownBlocks to={match.startsAt} className="[&_span.min-w-14]:min-w-12 [&_span.min-w-14]:text-2xl sm:[&_span.min-w-14]:min-w-14 sm:[&_span.min-w-14]:text-3xl" />
      </div>
    </div>
  );
}

function Stat({ icon, value, label, tone }: { icon: ReactNode; value: ReactNode; label: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5 sm:py-4">
      <span className={cn("hidden size-10 shrink-0 items-center justify-center rounded-xl sm:flex [&_svg]:size-5", tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="font-display text-2xl leading-none font-bold tabular-nums sm:text-3xl">{value}</p>
        <p className="mt-1 text-[11px] leading-tight font-semibold text-muted-foreground sm:text-xs">{label}</p>
      </div>
    </div>
  );
}

const pulse = <span className="inline-block h-7 w-8 animate-pulse rounded bg-muted align-middle" />;

/** Cinematic top-of-home banner: brand, team identity, the one primary action, next match and the team's numbers. */
export function HomeHero({
  team,
  greeting,
  data,
  loading,
  backdropUrl,
  error,
}: {
  team: TeamSummary | null;
  greeting: string;
  data: TeamDashboard | undefined;
  loading: boolean;
  backdropUrl: string | null;
  /** shown in place of the next-match panel when the dashboard failed to load */
  error?: ReactNode;
}) {
  const booked = !!data?.nextMatch;
  const today = data?.today;
  const best = data?.results?.bestRank;
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-sm animate-rise" data-tour="home-hero">
      <Backdrop url={backdropUrl} />
      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-10 lg:p-10">
        {/* identity + action */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Wordmark />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.2em] text-primary uppercase">Player hub</span>
          </div>
          <div className="mt-6 flex items-center gap-4 sm:mt-8">
            {team && (
              <div className="relative shrink-0">
                <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-br from-primary to-brand-300 opacity-60 blur-md" aria-hidden />
                <TeamAvatar name={team.name} tag={team.tag} size="lg" className="relative size-16 text-lg ring-2 ring-primary/60 sm:size-20 sm:text-xl" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                {greeting}
                {today && <span className="hidden sm:inline"> · {formatDate(today, "EEEE, d MMM")}</span>}
              </p>
              <h1 className="mt-1 truncate font-display text-3xl leading-[1.05] font-extrabold tracking-tight uppercase sm:text-5xl">
                {team?.name ?? "Your team"}
              </h1>
              {team && <p className="mt-1 font-mono text-xs font-semibold tracking-[0.3em] text-primary">[{team.tag}]</p>}
            </div>
          </div>
          <p className="mt-5 max-w-md text-sm text-muted-foreground sm:text-base">
            {booked
              ? "You're booked in. Keep an eye on the countdown — room details appear here before the match."
              : "Find a scrim, register your team, and start climbing the points tables."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button asChild size="lg" className="h-12 flex-1 px-6 text-base shadow-glow sm:flex-none" data-tour="find-scrim">
              <Link to="/team/scrims">
                <Search /> Find a scrim
              </Link>
            </Button>
            {booked && (
              <Button asChild size="lg" variant="outline" className="h-12 bg-background/60 backdrop-blur">
                <Link to="/team/registrations">
                  <Ticket /> My slots
                </Link>
              </Button>
            )}
          </div>
        </div>

        {error ?? <NextMatchPanel match={data?.nextMatch ?? null} today={today ?? ""} loading={loading} />}
      </div>

      {/* numbers */}
      <div className="grid grid-cols-2 divide-border border-t bg-background/50 backdrop-blur-md sm:grid-cols-4 sm:divide-x [&>*:nth-child(-n+2)]:border-b sm:[&>*:nth-child(-n+2)]:border-b-0 [&>*:nth-child(odd)]:border-r sm:[&>*:nth-child(odd)]:border-r-0" data-tour="stats">
        <Stat icon={<CalendarCheck />} tone="bg-success/10 text-success" value={data ? data.counts.approvedUpcoming : pulse} label="Approved upcoming" />
        <Stat icon={<Hourglass />} tone="bg-warning/15 text-warning-foreground dark:text-warning" value={data ? data.counts.pending : pulse} label="Waiting for approval" />
        <Stat icon={<Trophy />} tone="bg-primary/10 text-primary" value={data ? data.counts.totalPlayed : pulse} label="Matches played" />
        <Stat icon={<Medal />} tone="bg-warning/15 text-warning-foreground dark:text-warning" value={data ? (best != null ? `#${best}` : "—") : pulse} label="Best finish" />
      </div>
    </section>
  );
}

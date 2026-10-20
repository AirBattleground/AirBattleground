import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Crosshair, Flame, Gamepad2, Layers, ScrollText, Sparkles, Trophy, Users, UsersRound } from "lucide-react";
import type { StageDetail, StageSummary, TeamTournamentDetail } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { RankBadge } from "@/features/results/components/Rank";
import { OrganizerBadge, PosterThumb } from "@/features/team/components/Branding";
import { MapChips } from "@/features/team/components/MapChips";
import { RegistrationMeter } from "../../shared/RegistrationMeter";
import { StatusPill } from "../../shared/StatusPill";
import { fmtRange, plural, fmtPrize } from "../../shared/format";

function tournamentDates(t: Pick<TeamTournamentDetail, "startsAt" | "stages">) {
  const first = t.startsAt ?? t.stages[0]?.startsAt ?? null;
  const last = [...t.stages].reverse().find((s) => s.endsAt)?.endsAt ?? null;
  return fmtRange(first, last);
}

/** Faint, blurred poster wash behind the hero. Nothing when missing/broken. */
function PosterWash({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      decoding="async"
      onError={() => setFailed(true)}
      className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-15 blur-3xl dark:opacity-20"
    />
  );
}

/** Hero: poster, title, prize, organiser, dates, status (+ registration meter while open). */
export function TournamentHero({ t }: { t: TeamTournamentDetail }) {
  const showMeter = t.status === "REGISTRATION_OPEN" || t.status === "REGISTRATION_CLOSED";
  return (
    <section data-tour="hero" className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <PosterWash url={t.posterUrl} />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
      <div className="pointer-events-none absolute -top-28 -left-20 size-80 animate-aurora rounded-full bg-primary/20 blur-3xl motion-reduce:animate-none" />
      <motion.div
        aria-hidden
        className={cn("pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 text-primary/10", !showMeter && !t.posterUrl && "sm:block")}
        initial={{ rotate: -10, scale: 0.8, opacity: 0 }}
        animate={{ rotate: 8, scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <Trophy className="size-44" strokeWidth={1.25} />
      </motion.div>
      <div className="relative grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <PosterThumb url={t.posterUrl} title={t.title} className="size-28 rounded-2xl shadow-lg sm:size-40 lg:size-48" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={t.status} />
              <span className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Tournament</span>
            </div>
            <h1 className="mt-2 font-display text-3xl leading-[1.05] font-bold text-balance sm:text-5xl">{t.title}</h1>
            {t.prize && (
              <p className="mt-2 inline-flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 font-display text-xl font-bold text-warning-foreground sm:text-2xl dark:text-warning">
                <Trophy className="size-5" /> {fmtPrize(t.prize)}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4 text-primary" /> {tournamentDates(t)}
              </span>
              <OrganizerBadge
                manager={t.manager}
                prefix="by"
                iconClassName="size-4 text-primary"
                logoClassName="size-6"
                nameClassName="font-semibold text-foreground"
              />
              <span className="inline-flex items-center gap-1.5">
                <UsersRound className="size-4 text-primary" /> {t.teamSize}-player squads
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4 text-primary" /> {t.maxTeams} teams
              </span>
            </div>
            {t.description && <p className="mt-3 max-w-2xl text-sm whitespace-pre-line text-foreground/80">{t.description}</p>}
          </div>
        </div>
        {showMeter && (
          <div className="rounded-xl border bg-background/70 p-4 backdrop-blur">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Registered so far</p>
            <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Collapsible card section. */
export function Section({
  icon,
  title,
  children,
  defaultOpen = true,
  tour,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tour?: string;
  action?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-tour={tour} className={cn("rounded-2xl border bg-card shadow-sm", className)}>
      <div className="flex items-center gap-2 p-4 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="-m-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="text-primary [&_svg]:size-5">{icon}</span>
          <h2 className="truncate font-display text-xl font-bold">{title}</h2>
          <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/60 px-2.5 py-1.5">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="font-display text-base leading-tight font-bold">{value}</p>
    </div>
  );
}

function StageFormatRow({ s, last }: { s: StageSummary; last: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl p-3 text-left outline-none hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-sm font-bold text-primary">{s.order}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg leading-tight font-bold">{s.name}</span>
            <StatusPill kind="stage" status={s.status} className="px-2 py-px text-[10px]" />
          </span>
          <span className="block text-xs text-muted-foreground">
            {s.teamsIn} teams · {s.groupCount > 1 ? `${s.groupCount} groups of ~${s.lobbySize}` : "1 lobby"} · {plural(s.matchesPerGroup, "match", "matches")}
            {!last && ` · top ${s.advancePerGroup}${s.groupCount > 1 ? "/group" : ""}${s.wildcardCount ? ` + ${s.wildcardCount} wildcards` : ""} → ${s.teamsOut}`}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 px-3 pb-3">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <Fact label="Teams in" value={s.teamsIn} />
                <Fact label="Groups" value={`${s.groupCount} × ${s.lobbySize}`} />
                <Fact label={last ? "Winner" : "Advance"} value={last ? "1 champion" : `Top ${s.advancePerGroup}${s.groupCount > 1 ? "/grp" : ""}`} />
                <Fact label={last ? "Matches" : "Wildcards"} value={last ? s.matchesPerGroup : s.wildcardCount || "None"} />
              </div>
              {s.invitedSlots > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-info" /> {plural(s.invitedSlots, "invited team")} join directly at this stage.
                </p>
              )}
              {s.wildcardCount > 0 && !last && (
                <p className="text-xs text-muted-foreground">Wildcards go to the best teams that missed the top {s.advancePerGroup}, ranked by points per match across all groups.</p>
              )}
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Maps, in order</p>
                <MapChips maps={s.maps} />
              </div>
              {(s.startsAt || s.endsAt) && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5 text-primary" /> {fmtRange(s.startsAt, s.endsAt)}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Stages, groups, top N, wildcards, matches & maps. Each stage expands for more. */
export function FormatSummary({ t }: { t: TeamTournamentDetail }) {
  return (
    <Section icon={<Layers />} title="Format" tour="format">
      <ol className="space-y-2">
        {t.stages.map((s, i) => (
          <StageFormatRow key={s.id} s={s} last={i === t.stages.length - 1} />
        ))}
      </ol>
    </Section>
  );
}

export function RulesSection({ rules }: { rules: string }) {
  return (
    <Section icon={<ScrollText />} title="Rules" defaultOpen={false} tour="rules">
      <div className="max-h-96 overflow-y-auto pr-1 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{rules}</div>
    </Section>
  );
}

/** "Who's on fire" — top teams by points per match + top fraggers for a stage. */
export function OnFire({ stage, limit = 5, href, compact }: { stage: StageDetail; limit?: number; href?: string; compact?: boolean }) {
  const teams = stage.topTeams.slice(0, limit);
  const fraggers = stage.topFraggers.slice(0, limit);
  const maxPpm = Math.max(1, ...teams.map((t) => t.pointsPerMatch));
  const maxKills = Math.max(1, ...fraggers.map((f) => f.kills));
  if (teams.length === 0 && fraggers.length === 0) return null;
  return (
    <section data-tour="on-fire" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Flame className="size-5 text-primary" />
        <h2 className="font-display text-xl font-bold">Who's on fire</h2>
        <span className="text-xs text-muted-foreground">· {stage.stage.name}</span>
        {href && (
          <Link to={href} className="ml-auto text-xs font-semibold text-primary underline-offset-4 hover:underline">
            Full stage →
          </Link>
        )}
      </div>
      <div className={cn("grid gap-5", !compact && "md:grid-cols-2")}>
        {teams.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <Gamepad2 className="size-3.5" /> Points per match
            </p>
            <ol className="space-y-1.5">
              {teams.map((r, i) => (
                <li key={r.team.id} className="flex items-center gap-2.5">
                  <RankBadge rank={i + 1} size="sm" />
                  <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{r.team.name}</span>
                      <span className="shrink-0 font-display text-base font-bold tabular-nums">{r.pointsPerMatch.toFixed(1)}</span>
                    </p>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${(r.pointsPerMatch / maxPpm) * 100}%` }}
                        transition={{ duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Group {r.groupName} · {r.totalPoints} pts in {plural(r.matchesPlayed, "match", "matches")} · {r.kills} finishes
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {fraggers.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <Crosshair className="size-3.5" /> Top fraggers
            </p>
            <ol className="space-y-1.5">
              {fraggers.map((f, i) => (
                <li key={`${f.team.id}-${f.name}`} className="flex items-center gap-2.5">
                  <RankBadge rank={i + 1} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {f.name} <span className="font-normal text-muted-foreground">· {f.team.tag}</span>
                      </span>
                      <span className="shrink-0 font-display text-base font-bold tabular-nums">{f.kills}</span>
                    </p>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-info/60 to-info"
                        initial={{ width: 0 }}
                        animate={{ width: `${(f.kills / maxKills) * 100}%` }}
                        transition={{ duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Crosshair, Gamepad2, Layers, ScrollText, Sparkles, Trophy } from "lucide-react";
import type { StageDetail, StageSummary, TeamTournamentDetail } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { RankBadge } from "@/features/results/components/Rank";
import { OrganizerBadge, PosterThumb } from "@/features/team/components/Branding";
import { MapChips } from "@/features/team/components/MapChips";
import { StatusPill } from "../../shared/StatusPill";
import { fmtPrize, useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { tShared } from "@/i18n/tournaments";
import { tHub } from "@/i18n/tournamentsHub";

function tournamentDates(t: Pick<TeamTournamentDetail, "startsAt" | "stages">, fmtRange: (a: string | null, b: string | null) => string) {
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

/** Small uppercase label that names a panel/zone (Arena-lobby style). */
export function ZoneLabel({ children, action, className, id }: { children: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-2", className)}>
      <h2 id={id} className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

function Fact({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-card/95 px-4 py-3 sm:px-5", className)}>
      <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 truncate font-display text-lg leading-tight font-bold sm:text-xl">{value}</dd>
      {sub && <dd className="truncate text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

/** Hero: poster, status, title, prize, organiser, short description + one strip of key facts. */
export function TournamentHero({ t }: { t: TeamTournamentDetail }) {
  const th = useT(tHub);
  const tsh = useT(tShared);
  const { fmtRange } = useTournamentFormat();
  const [more, setMore] = useState(false);
  const regPhase = t.status === "REGISTRATION_OPEN" || t.status === "REGISTRATION_CLOSED";
  const left = Math.max(0, t.maxTeams - t.confirmedCount);
  const longDesc = (t.description?.length ?? 0) > 160 || (t.description?.split("\n").length ?? 0) > 2;
  return (
    <section data-tour="hero" className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <PosterWash url={t.posterUrl} />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
      <div className="relative flex gap-4 p-4 sm:gap-6 sm:p-6">
        <PosterThumb url={t.posterUrl} title={t.title} className="size-20 shrink-0 rounded-xl shadow-lg sm:size-32" />
        <div className="min-w-0 flex-1">
          <StatusPill status={t.status} />
          <h1 className="mt-2 font-display text-2xl leading-[1.05] font-bold text-balance sm:text-4xl">{t.title}</h1>
          {t.prize && (
            <p className="mt-1.5 inline-flex items-center gap-2 font-display text-xl font-bold text-warning-foreground sm:text-2xl dark:text-warning">
              <Trophy className="size-5" /> {fmtPrize(t.prize)}
            </p>
          )}
          <div className="mt-1.5 text-sm text-muted-foreground">
            <OrganizerBadge manager={t.manager} prefix={th("by")} iconClassName="size-4" logoClassName="size-5" nameClassName="font-medium text-foreground" />
          </div>
        </div>
      </div>
      {t.description && (
        <div className="relative px-4 pb-4 sm:px-6">
          <p className={cn("max-w-3xl text-sm whitespace-pre-line text-foreground/80", !more && "line-clamp-2")}>{t.description}</p>
          {longDesc && (
            <button
              type="button"
              onClick={() => setMore((m) => !m)}
              aria-expanded={more}
              className="mt-1 rounded text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {more ? th("read_less") : th("read_more")}
            </button>
          )}
        </div>
      )}
      <dl className="relative grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
        <Fact label={th("fact_dates")} value={<span className="text-base sm:text-lg">{tournamentDates(t, fmtRange)}</span>} />
        <Fact
          label={th("fact_teams")}
          value={
            <span className="tabular-nums">
              {t.confirmedCount}
              <span className="text-muted-foreground">/{t.maxTeams}</span>
            </span>
          }
          sub={regPhase ? (left === 0 ? tsh("meter_full") : tsh.plural("meter_left", left)) : undefined}
        />
        <Fact label={th("fact_stages")} value={t.stages.length} sub={t.currentStage?.name} />
        <Fact label={th("fact_squad")} value={th("squad_val", { n: t.teamSize })} />
      </dl>
    </section>
  );
}

/** Collapsible row (no card of its own) — used inside the hub's details panel. */
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
    <section data-tour={tour} className={cn("py-1", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="text-primary [&_svg]:size-4">{icon}</span>
          <h3 className="truncate font-display text-lg font-bold">{title}</h3>
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
            <div className="pt-1 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function StageFormatRow({ s, last }: { s: StageSummary; last: boolean }) {
  const th = useT(tHub);
  const tsh = useT(tShared);
  const { fmtRange } = useTournamentFormat();
  const adv = `${s.groupCount > 1 ? th("adv_top_group", { n: s.advancePerGroup }) : th("adv_top", { n: s.advancePerGroup })}${s.wildcardCount ? th("adv_wc", { count: s.wildcardCount }) : ""}`;
  return (
    <li className="flex gap-3 py-3 first:pt-1 last:pb-1">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-sm font-bold text-primary">{s.order}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-base leading-tight font-bold">{s.name}</span>
          {(s.startsAt || s.endsAt) && <span className="text-xs text-muted-foreground">{fmtRange(s.startsAt, s.endsAt)}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {tsh.plural("teams", s.teamsIn)} · {s.groupCount > 1 ? th("groups_of", { groups: s.groupCount, size: s.lobbySize }) : tsh("flow_lobby_one")} · {tsh.plural("matches", s.matchesPerGroup)}
          {!last && ` · ${adv} → ${s.teamsOut}`}
        </p>
        {s.invitedSlots > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-info" /> {th.plural("invited_join", s.invitedSlots)}
          </p>
        )}
        {s.wildcardCount > 0 && !last && <p className="text-xs text-muted-foreground">{th("wildcard_explain", { n: s.advancePerGroup })}</p>}
        <MapChips maps={s.maps} />
      </div>
    </li>
  );
}

/** Stages, groups, top N, wildcards, matches & maps (collapsed by default — the road above covers the basics). */
export function FormatSummary({ t, defaultOpen = false }: { t: TeamTournamentDetail; defaultOpen?: boolean }) {
  const th = useT(tHub);
  return (
    <Section icon={<Layers />} title={th("format")} tour="format" defaultOpen={defaultOpen}>
      <ol className="divide-y">
        {t.stages.map((s, i) => (
          <StageFormatRow key={s.id} s={s} last={i === t.stages.length - 1} />
        ))}
      </ol>
    </Section>
  );
}

export function RulesSection({ rules }: { rules: string }) {
  const th = useT(tHub);
  return (
    <Section icon={<ScrollText />} title={th("rules")} defaultOpen={false} tour="rules">
      <div className="max-h-96 overflow-y-auto pr-1 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{rules}</div>
    </Section>
  );
}

/** "Who's on fire" — top teams by points per match + top fraggers for a stage. */
export function OnFire({ stage, limit = 5, href, compact }: { stage: StageDetail; limit?: number; href?: string; compact?: boolean }) {
  const th = useT(tHub);
  const tsh = useT(tShared);
  const teams = stage.topTeams.slice(0, limit);
  const fraggers = stage.topFraggers.slice(0, limit);
  const maxPpm = Math.max(1, ...teams.map((t) => t.pointsPerMatch));
  const maxKills = Math.max(1, ...fraggers.map((f) => f.kills));
  if (teams.length === 0 && fraggers.length === 0) return null;
  return (
    <section data-tour="on-fire" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <ZoneLabel
        action={
          href && (
            <Link to={href} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
              {th("full_stage")}
            </Link>
          )
        }
      >
        {th("on_fire")} · {stage.stage.name}
      </ZoneLabel>
      <div className={cn("grid gap-5", !compact && "md:grid-cols-2")}>
        {teams.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <Gamepad2 className="size-3.5" /> {th("ppm")}
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
                      {th("fire_line", { group: r.groupName, pts: r.totalPoints, matches: tsh.plural("matches", r.matchesPlayed), kills: r.kills })}
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
              <Crosshair className="size-3.5" /> {th("top_fraggers")}
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

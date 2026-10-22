import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Crosshair, Gamepad2, Layers, Map as MapIcon, ScrollText, Share2, Sparkles, Trophy, Users } from "lucide-react";
import { MAP_LABELS, type StageDetail, type StageSummary, type TeamTournamentDetail } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { RankBadge } from "@/features/results/components/Rank";
import { PointsLegend } from "@/features/results/components/Standings";
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

/** Faint, blurred poster wash behind a panel. Nothing when missing/broken. */
export function PosterWash({ url, className }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-15 blur-3xl dark:opacity-20", className)}
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

/** Big panel heading (display face, uppercase) with an optional one-line explainer. */
export function PanelTitle({ id, children, desc, className }: { id?: string; children: ReactNode; desc?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4", className)}>
      <h2 id={id} className="font-display text-xl leading-tight font-bold tracking-wide uppercase sm:text-2xl">
        {children}
      </h2>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
    </div>
  );
}

/**
 * The poster as the page's key art: edge to edge and up under the see-through header (--shell-top, set by the shell).
 * Desktop: the poster sits on the right and is washed into the page on the left (where the copy is) and at the bottom.
 * Phones: the whole poster (25:9) on top; the copy starts under it. Every wash uses --background, so light and dark blend.
 */
function HeroPoster({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  const show = !!url && !failed;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-4 top-[calc(-1*var(--shell-top,0px)-1rem)] bottom-0 -z-10 overflow-hidden sm:-inset-x-5 sm:top-[calc(-1*var(--shell-top,0px)-1.25rem)] lg:-inset-x-6"
    >
      {show ? (
        <>
          {/* blurred fill: no hard edges under the header or beside the poster */}
          <img src={url} alt="" decoding="async" className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl saturate-150 dark:opacity-40" />
          <img
            src={url}
            alt=""
            decoding="async"
            fetchPriority="high"
            onError={() => setFailed(true)}
            className={cn(
              "absolute inset-x-0 top-[calc(var(--shell-top,0px)+4rem)] aspect-[25/9] w-full object-cover [mask-image:linear-gradient(to_bottom,#000_75%,transparent)] sm:top-[calc(var(--shell-top,0px)+4.25rem)]",
              "lg:inset-y-0 lg:top-0 lg:right-0 lg:left-auto lg:aspect-auto lg:h-full lg:w-[80%] lg:object-[15%_45%] lg:[mask-image:linear-gradient(90deg,transparent,#000_18%)]",
            )}
          />
        </>
      ) : (
        <>
          <div className="absolute -top-10 right-[10%] size-[28rem] rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute inset-0 bg-grid opacity-50" />
          <Trophy className="absolute top-[calc(var(--shell-top,0px)+3rem)] right-[8%] size-56 rotate-12 text-primary/10 max-lg:hidden" />
        </>
      )}
      {/* copy side (desktop) */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_oklch,var(--background)_85%,transparent)_20%,color-mix(in_oklch,var(--background)_25%,transparent)_38%,transparent_52%)] max-lg:hidden" />
      {/* under the header: just enough page colour to keep the nav readable */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background/50 to-transparent" />
      {/* bottom: melt into the page */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-background via-background/80 to-transparent max-lg:h-3/5" />
    </div>
  );
}

function OrgLogo({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img src={url} alt="" onError={() => setFailed(true)} className="size-11 shrink-0 rounded-full bg-muted object-cover ring-2 ring-border dark:bg-foreground/90 sm:size-12" />
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-xl font-bold text-primary ring-2 ring-primary/30 sm:size-12">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Fact({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5 sm:py-4">
      <span className="hidden shrink-0 text-primary sm:block [&_svg]:size-7 [&_svg]:stroke-[1.5]">{icon}</span>
      <dl className="min-w-0">
        <dt className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</dt>
        <dd className="truncate font-display text-lg leading-tight font-bold tabular-nums">{value}</dd>
        {sub && <dd className="truncate text-xs text-muted-foreground">{sub}</dd>}
      </dl>
    </div>
  );
}

function ShareButton({ title }: { title: string }) {
  const th = useT(tHub);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      toast.success(th("link_copied"));
    } catch {
      /* user closed the share sheet */
    }
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground/15 bg-background/60 px-3 text-sm font-semibold backdrop-blur-md transition-colors outline-none hover:bg-background/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Share2 className="size-4" /> {th("share")}
    </button>
  );
}

/** Hero: the poster as full-bleed key art; status, title, prize, organiser, about + chips on the left; key facts in a glass strip. */
export function TournamentHero({ t }: { t: TeamTournamentDetail }) {
  const th = useT(tHub);
  const tsh = useT(tShared);
  const { fmtRange, fmtTime } = useTournamentFormat();
  const [more, setMore] = useState(false);
  const regPhase = t.status === "REGISTRATION_OPEN" || t.status === "REGISTRATION_CLOSED";
  const left = Math.max(0, t.maxTeams - t.confirmedCount);
  const longDesc = (t.description?.length ?? 0) > 160 || (t.description?.split("\n").length ?? 0) > 2;
  const maps = useMemo(() => [...new Set(t.stages.flatMap((s) => s.maps))], [t.stages]);
  const chip = "rounded-md border border-foreground/15 bg-background/55 px-2.5 py-1 text-xs font-semibold backdrop-blur-md";
  return (
    <section data-tour="hero" className="relative isolate">
      <HeroPoster url={t.posterUrl} />

      <div className="flex items-center justify-between gap-3">
        <Link
          to="/team/tournaments"
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" /> {th("back_all")}
        </Link>
        <ShareButton title={t.title} />
      </div>

      {/* phones: room for the poster, which sits behind this spacer */}
      <div aria-hidden className={cn("-mx-4 sm:-mx-5 lg:hidden", t.posterUrl ? "mt-3 aspect-[25/9]" : "h-6")} />

      <div className="grid gap-6 pt-4 lg:min-h-[27rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,46rem)] lg:items-end lg:pt-10">
        <div className="min-w-0 max-w-2xl">
          <StatusPill status={t.status} />
          <h1 className="mt-3 font-display text-4xl leading-[0.95] font-extrabold tracking-tight text-balance uppercase drop-shadow-[0_2px_12px_var(--background)] sm:text-5xl xl:text-6xl">
            {t.title}
          </h1>
          {t.prize && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Trophy className="size-7 text-warning-foreground sm:size-8 dark:text-warning" />
              <span className="tc-prize font-display text-3xl leading-none font-extrabold text-warning-foreground sm:text-4xl dark:text-warning">{fmtPrize(t.prize)}</span>
              <span className="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">{th("prize_pool")}</span>
            </p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <OrgLogo url={t.manager.logoUrl} name={t.manager.displayName} />
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-tight font-bold">{t.manager.displayName}</p>
              <p className="text-xs text-muted-foreground">{th("organizer")}</p>
            </div>
          </div>
          {t.description && (
            <div className="mt-4">
              <p className={cn("text-sm whitespace-pre-line text-foreground/85", !more && "line-clamp-2")}>{t.description}</p>
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
          {maps.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {maps.map((m) => (
                <li key={m} className={cn(chip, "inline-flex items-center gap-1.5")}>
                  <MapIcon className="size-3.5 text-primary" /> {MAP_LABELS[m]}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 divide-foreground/10 overflow-hidden rounded-2xl border border-foreground/10 bg-background/70 shadow-lg backdrop-blur-xl max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*:nth-child(-n+2)]:border-foreground/10 max-sm:[&>*:nth-child(odd)]:border-r max-sm:[&>*:nth-child(odd)]:border-foreground/10 sm:grid-cols-[1.35fr_1fr_1fr_1fr] sm:divide-x">
          <Fact
            icon={<CalendarDays />}
            label={th("fact_dates")}
            value={tournamentDates(t, fmtRange)}
            sub={t.startsAt ? th("fact_time_ist", { time: fmtTime(t.startsAt) }) : undefined}
          />
          <Fact
            icon={<Users />}
            label={th("fact_teams")}
            value={
              <>
                {t.confirmedCount}
                <span className="text-muted-foreground"> / {t.maxTeams}</span>
              </>
            }
            sub={regPhase ? (left === 0 ? tsh("meter_full") : tsh.plural("meter_left", left)) : undefined}
          />
          <Fact icon={<Layers />} label={th("fact_stages")} value={t.stages.length} sub={t.currentStage?.name ?? t.stages.map((s) => s.name).join(" + ")} />
          <Fact icon={<Gamepad2 />} label={th("fact_squad")} value={th("squad_val", { n: t.teamSize })} sub="BGMI" />
        </div>
      </div>
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
          {tsh.plural("teams", s.teamsIn)} · {s.groupCount > 1 ? th("groups_of", { groups: s.groupCount, size: s.lobbySize }) : tsh("flow_lobby_one")} ·{" "}
          {tsh.plural("matches", s.matchesPerGroup)}
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

/** Points system · Format (stages, groups, top N, wildcards, matches & maps) · Rules, as tabs. */
export function DetailsTabs({ t }: { t: TeamTournamentDetail }) {
  const th = useT(tHub);
  const tabs = [
    { key: "points", label: th("tab_points"), icon: Trophy },
    { key: "format", label: th("tab_format"), icon: Layers },
    ...(t.rules ? [{ key: "rules", label: th("tab_rules"), icon: ScrollText }] : []),
  ];
  return (
    <section data-tour="format" aria-labelledby="details-title" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <PanelTitle id="details-title">{th("details")}</PanelTitle>
      <Tabs defaultValue="points" className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto gap-1 p-1">
            {tabs.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="h-10 gap-2 px-4 text-sm data-[state=active]:text-primary">
                <Icon className="size-4" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="points">
          <p className="mb-3 text-sm text-muted-foreground">{th("points_desc")}</p>
          <PointsLegend ps={t.pointsSystem} className="rounded-none border-0 bg-transparent p-0 shadow-none" />
        </TabsContent>
        <TabsContent value="format">
          <ol className="divide-y">
            {t.stages.map((s, i) => (
              <StageFormatRow key={s.id} s={s} last={i === t.stages.length - 1} />
            ))}
          </ol>
        </TabsContent>
        {t.rules && (
          <TabsContent value="rules">
            <div className="max-h-96 overflow-y-auto pr-1 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{t.rules}</div>
          </TabsContent>
        )}
      </Tabs>
    </section>
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

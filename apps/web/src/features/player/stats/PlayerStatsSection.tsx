import { useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { BarChart3, Crosshair, Hexagon, Map as MapIcon, Medal, Trophy, Users } from "lucide-react";
import {
  MAP_LABELS,
  MIN_RATED_MATCHES,
  PLAYER_STATS_PERIODS,
  PLAYER_STATS_SCOPES,
  type GameMap,
  type PlayerGrade,
  type PlayerStats,
  type PlayerStatsPeriod,
  type PlayerStatsRadar,
  type PlayerStatsScope,
} from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { QueryError } from "@/features/team/components/QueryError";
import { useT, type T as Translator } from "@/i18n/core";
import { statsMsg } from "@/i18n/playerStats";
import { usePlayerStats } from "./api";

type T = Translator<typeof statsMsg.en>;

const mapName = (m: string) => MAP_LABELS[m as GameMap] ?? m;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const day = (iso: string) => format(parseISO(iso), "d MMM");

/** Grade colours: gold for the top grades, then primary, then muted. Text only — it always sits beside the number. */
const GRADE_TONE: Record<PlayerGrade, string> = {
  SS: "from-warning via-warning to-warning-foreground/70 dark:to-warning/60",
  S: "from-warning via-warning to-warning-foreground/70 dark:to-warning/60",
  A: "from-primary via-primary to-primary/60",
  B: "from-primary via-primary to-primary/60",
  C: "from-muted-foreground via-muted-foreground to-muted-foreground/60",
  D: "from-muted-foreground via-muted-foreground to-muted-foreground/60",
};

// ---------------------------------------------------------------- radar

/** Axis order around the pentagon, clockwise from the top. */
const AXES: { key: keyof PlayerStatsRadar; label: "ax_wins" | "ax_impact" | "ax_consistency" | "ax_survival" | "ax_combat" }[] = [
  { key: "wins", label: "ax_wins" },
  { key: "impact", label: "ax_impact" },
  { key: "consistency", label: "ax_consistency" },
  { key: "survival", label: "ax_survival" },
  { key: "combat", label: "ax_combat" },
];

function Radar({ radar, t }: { radar: PlayerStatsRadar; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  const C = 150;
  const R = 92;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  };
  const ring = (f: number) => AXES.map((_, i) => pt(i, R * f).join(",")).join(" ");
  const shape = AXES.map((a, i) => pt(i, (R * radar[a.key]) / 100).join(",")).join(" ");
  const aria = t("radar_aria", { list: AXES.map((a) => `${t(a.label)} ${radar[a.key]}`).join(", ") });
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label={aria} className="mx-auto w-full max-w-[19rem] overflow-visible">
      {/* recessive grid: 4 rings + spokes */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} className={cn("fill-none stroke-border", f === 1 && "fill-muted/40")} strokeWidth={1} />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={C} y1={C} x2={x} y2={y} className="stroke-border" strokeWidth={1} />;
      })}
      <polygon points={shape} className="fill-primary/25 stroke-primary" strokeWidth={2} strokeLinejoin="round" />
      {AXES.map((a, i) => {
        const [x, y] = pt(i, (R * radar[a.key]) / 100);
        const [lx, ly] = pt(i, R + 30);
        const anchor = Math.abs(lx - C) < 4 ? "middle" : lx > C ? "start" : "end";
        const on = hover === i;
        return (
          <g key={a.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            {/* hit target bigger than the dot */}
            <circle cx={x} cy={y} r={14} className="fill-transparent" />
            <circle cx={x} cy={y} r={on ? 6 : 4} className="fill-primary stroke-card transition-all" strokeWidth={2} />
            <text x={lx} y={ly - 4} textAnchor={anchor} className={cn("fill-foreground font-display text-[19px] font-bold tabular-nums", on && "fill-primary")}>
              {radar[a.key].toFixed(1)}
            </text>
            <text x={lx} y={ly + 13} textAnchor={anchor} className="fill-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              {t(a.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- recent form (kills per match)

function FormChart({ trend, t }: { trend: PlayerStats["trend"]; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(4, ...trend.map((m) => m.kills));
  const ticks = [0, Math.round(max / 2), max];
  const tip = hover != null ? trend[hover] : null;
  return (
    <figure className="w-full">
      <figcaption className="mb-3 flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
        {tip ? (
          <span className="text-foreground">
            <span className="font-semibold">{day(tip.playedAt)}</span> · #{tip.placement ?? "—"} · <span className="font-semibold tabular-nums">{t.plural("kills_n", tip.kills)}</span>
          </span>
        ) : (
          <span>{t("form_kills", { n: trend.length })}</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warning" aria-hidden /> {t("form_win")}
        </span>
      </figcaption>
      <div className="relative mt-2 h-44 pl-6" role="img" aria-label={t("form_aria", { n: trend.length })}>
        {/* y ticks + recessive grid */}
        {ticks.map((v) => (
          <div key={v} className="absolute inset-x-0 flex items-center gap-1.5" style={{ bottom: `${(v / max) * 100}%` }}>
            <span className="w-4 -translate-y-px text-right text-[10px] text-muted-foreground tabular-nums">{v}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-6 flex items-end gap-[2px]">
          {trend.map((m, i) => (
            <button
              key={`${m.playedAt}-${i}`}
              type="button"
              aria-label={t("form_tip", { day: day(m.playedAt), place: m.placement ?? "—", kills: m.kills })}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="group relative flex h-full flex-1 items-end outline-none"
            >
              <span
                className={cn(
                  "w-full rounded-t-[4px] transition-opacity",
                  m.placement === 1 ? "bg-warning" : "bg-primary",
                  hover != null && hover !== i && "opacity-40",
                )}
                style={{ height: `${Math.max(2, (m.kills / max) * 100)}%` }}
              />
            </button>
          ))}
        </div>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- tiles

function Headline({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 px-1 py-4 text-center sm:px-3 sm:py-5">
      <p className="truncate text-[9px] font-semibold tracking-wide text-muted-foreground uppercase sm:text-xs sm:tracking-[0.12em]">{label}</p>
      <p className="mt-1 font-display text-3xl leading-none font-bold tabular-nums sm:text-5xl">{value}</p>
    </div>
  );
}

function StatRow({ icon, items }: { icon: ReactNode; items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] items-center gap-2 py-4 sm:grid-cols-[3.5rem_repeat(3,minmax(0,1fr))]">
      <span className="flex justify-center text-primary [&_svg]:size-6 sm:[&_svg]:size-7">{icon}</span>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 text-center">
          <p className="text-[11px] leading-tight text-muted-foreground sm:truncate sm:text-xs">{it.label}</p>
          <p className="mt-0.5 font-display text-base leading-tight font-bold break-words tabular-nums sm:truncate sm:text-2xl">{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Skeleton className="h-[26rem] rounded-2xl" />
      <div className="space-y-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- section

/** Player statistics report (profile page): grade + radar / form on the left, the numbers on the right, maps + recent below. */
export function PlayerStatsSection({ className }: { className?: string }) {
  const t = useT(statsMsg);
  const [scope, setScope] = useState<PlayerStatsScope>("ALL");
  const [period, setPeriod] = useState<PlayerStatsPeriod>("ALL_TIME");
  const [view, setView] = useState<"radar" | "form">("radar");
  const q = usePlayerStats(scope, period);
  const s = q.data;
  const filtered = scope !== "ALL" || period !== "ALL_TIME";

  const filters = (
    <div className="flex flex-wrap gap-2">
      <Select value={scope} onValueChange={(v) => setScope(v as PlayerStatsScope)}>
        <SelectTrigger className="h-10 min-w-36 gap-2 font-semibold tracking-wide uppercase" aria-label={t("scope_ALL")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLAYER_STATS_SCOPES.map((v) => (
            <SelectItem key={v} value={v}>
              {t(`scope_${v}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={period} onValueChange={(v) => setPeriod(v as PlayerStatsPeriod)}>
        <SelectTrigger className="h-10 min-w-36 gap-2 font-semibold tracking-wide uppercase" aria-label={t("period_ALL_TIME")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLAYER_STATS_PERIODS.map((v) => (
            <SelectItem key={v} value={v}>
              {t(`period_${v}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  let body: ReactNode;
  if (q.isError) body = <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_err")} />;
  else if (!s) body = <StatsSkeleton />;
  else if (s.matches === 0) body = <EmptyState icon={<BarChart3 />} title={t("empty_title")} description={filtered ? t("empty_filter") : t("empty_desc")} />;
  else {
    const most = s.maps[0];
    const bestMap = [...s.maps].filter((m) => m.matches >= 3 && m.avgPlacement != null).sort((a, b) => a.avgPlacement! - b.avgPlacement!)[0];
    body = (
      <div className={cn("grid gap-4 transition-opacity lg:grid-cols-[20rem_minmax(0,1fr)]", q.isPlaceholderData && "opacity-60")}>
        {/* left: grade + rating, then radar / form */}
        <div className="flex flex-col rounded-2xl border bg-background/50 p-4 sm:p-5 lg:self-start">
          <div className="text-center">
            {s.grade ? (
              <p
                className={cn(
                  "bg-gradient-to-b bg-clip-text font-display text-8xl leading-none font-extrabold text-transparent drop-shadow-[0_4px_18px_color-mix(in_oklch,var(--warning)_30%,transparent)]",
                  GRADE_TONE[s.grade],
                )}
              >
                {s.grade}
              </p>
            ) : (
              <p className="font-display text-4xl leading-none font-bold text-muted-foreground uppercase">{t("unrated")}</p>
            )}
            <p className="mt-2 font-display text-2xl font-bold" title={t("rating_how")}>
              {t("rating")}: <span className="tabular-nums">{s.rating?.toFixed(1) ?? "—"}</span>
            </p>
            {s.rating == null && <p className="mt-1 text-xs text-muted-foreground">{t.plural("unrated", MIN_RATED_MATCHES - s.matches)}</p>}
          </div>
          <div className="mt-4 flex min-h-[17rem] items-center">{view === "radar" ? <Radar radar={s.radar} t={t} /> : <FormChart trend={s.trend} t={t} />}</div>
          <div role="tablist" className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border">
            {(
              [
                ["radar", Hexagon, t("view_radar")],
                ["form", BarChart3, t("view_form")],
              ] as const
            ).map(([v, Icon, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                aria-label={label}
                title={label}
                onClick={() => setView(v)}
                className={cn(
                  "flex h-10 items-center justify-center gap-2 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/40",
                )}
              >
                <Icon className="size-4" /> <span className="max-sm:sr-only">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* right: the numbers */}
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-2xl border">
            <div className="grid grid-cols-5 divide-x bg-muted/50">
              <Headline label={t("matches")} value={s.matches} />
              <Headline label={t("wins")} value={s.wins} />
              <Headline label={t("top5")} value={s.top5} />
              <Headline label={t("kills")} value={s.kills} />
              <Headline label={t("kpm")} value={s.killsPerMatch.toFixed(1)} />
            </div>
            <div className="divide-y px-2 sm:px-4">
              <StatRow
                icon={<Trophy />}
                items={[
                  { label: t("win_rate"), value: pct(s.winRate) },
                  { label: t("top5_rate"), value: pct(s.top5Rate) },
                  { label: t("avg_place"), value: s.avgPlacement != null ? `#${s.avgPlacement.toFixed(1)}` : "—" },
                ]}
              />
              <StatRow
                icon={<Crosshair />}
                items={[
                  { label: t("kpm"), value: s.killsPerMatch.toFixed(1) },
                  { label: t("kill_share"), value: s.killShare != null ? pct(s.killShare) : "—" },
                  { label: t("best_match"), value: s.best ? t("best_val", { kills: s.best.kills, place: s.best.placement ?? "—" }) : "—" },
                ]}
              />
              <StatRow
                icon={<Users />}
                items={[
                  { label: t("team_points"), value: s.avgTeamPoints?.toFixed(1) ?? "—" },
                  { label: t("most_played"), value: most ? t("map_val", { map: mapName(most.map), n: most.matches }) : "—" },
                  { label: t("best_map"), value: bestMap ? t("map_val", { map: mapName(bestMap.map), n: `#${bestMap.avgPlacement!.toFixed(1)}` }) : "—" },
                ]}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* maps: kills per match as a thin bar, one hue */}
            <section className="rounded-2xl border p-4" aria-labelledby="stats-maps">
              <h3 id="stats-maps" className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                <MapIcon className="size-3.5" /> {t("maps_title")}
              </h3>
              <ul className="space-y-3">
                {s.maps.map((m) => {
                  const kpm = m.matches ? m.kills / m.matches : 0;
                  const maxKpm = Math.max(...s.maps.map((x) => (x.matches ? x.kills / x.matches : 0)), 1);
                  return (
                    <li key={m.map}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-display text-base font-bold">{mapName(m.map)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{m.avgPlacement != null ? t("avg_place_short", { place: m.avgPlacement.toFixed(1) }) : ""}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(kpm / maxKpm) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{t("map_row", { matches: m.matches, wins: m.wins, kpm: kpm.toFixed(1) })}</p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl border p-4" aria-labelledby="stats-recent">
              <h3 id="stats-recent" className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                <Medal className="size-3.5" /> {t("recent_title")}
              </h3>
              <ol className="divide-y">
                {s.recent.map((m) => (
                  <li key={m.matchId} className="flex items-center gap-3 py-2">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg font-display text-base font-bold tabular-nums",
                        m.placement === 1 ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted",
                      )}
                    >
                      {m.placement != null ? `#${m.placement}` : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.eventTitle}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {day(m.playedAt)} · {mapName(m.map)}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-base font-bold tabular-nums">{t.plural("kills_n", m.kills)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section data-tour="player-stats" aria-labelledby="stats-title" className={cn("rounded-2xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="stats-title" className="font-display text-xl leading-tight font-bold tracking-wide uppercase sm:text-2xl">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("desc")}</p>
        </div>
        {filters}
      </div>
      {body}
    </section>
  );
}

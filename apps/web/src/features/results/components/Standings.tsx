import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, Crosshair, Info, Trophy } from "lucide-react";
import { toast } from "sonner";
import { MAP_LABELS, type PointsSystem, type SessionStandings, type StandingsRow } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { useDateFormat, useT, type T } from "@/i18n/core";
import { resultsMsg, useOrdinal } from "@/i18n/results";
import { ChickenDinner, PODIUM, RankBadge } from "./Rank";

type RT = T<(typeof resultsMsg)["en"]>;
type Ord = (n: number) => string;
type Fmt = (date: string, pattern: string) => string;

type Match = SessionStandings["matches"][number];

const slotText = (n: number | null) => (n == null ? "" : `#${String(n).padStart(2, "0")}`);

/** Plain-text points table for WhatsApp / Discord. */
function standingsText(s: SessionStandings, t: RT, ord: Ord, fmt: Fmt): string {
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  const lines = [
    `🏆 ${s.scrim.title} — ${fmt(s.date, "EEE, d MMM")}`,
    t("txt_header", { done: published, total: s.matches.length }),
    "",
  ];
  for (const r of s.rows) {
    const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}.`;
    const wins = r.wins ? ` · ${r.wins}🍗` : "";
    const team = `${r.team.name}${r.slotNumber != null ? ` (${slotText(r.slotNumber)})` : ""}`;
    lines.push(`${medal} ${t("txt_row", { team, pts: r.totalPoints, fin: r.kills })}${wins}`);
  }
  lines.push("", t("txt_points", { summary: pointsSummary(s.pointsSystem, t, ord) }));
  return lines.join("\n");
}

function pointsSummary(ps: PointsSystem, t: RT, ord: Ord): string {
  const n = ps.placement.length;
  return t("txt_summary", { list: ps.placement.join("/"), last: ord(n), n, kp: ps.killPoints });
}

async function copyStandings(s: SessionStandings, t: RT, ord: Ord, fmt: Fmt) {
  try {
    await navigator.clipboard.writeText(standingsText(s, t, ord, fmt));
    toast.success(t("copied"), { description: t("copied_desc") });
  } catch {
    toast.error(t("copy_failed"), { description: t("copy_failed_desc") });
  }
}

/** Legend explaining how points are counted. */
export function PointsLegend({ ps, action, className }: { ps: PointsSystem; action?: ReactNode; className?: string }) {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const note = t("legend_note", { ord: ord(ps.placement.length), n: ps.placement.length });
  return (
    <div data-tour="points-legend" className={cn("rounded-2xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {t("how_points")}
          <span title={note} aria-label={note} role="img" className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
            <Info className="size-3.5" />
          </span>
        </h3>
        {action}
      </div>
      <div className="flex flex-wrap gap-1">
        {ps.placement.map((p, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex min-w-11 flex-col items-center rounded-md border px-1.5 py-0.5",
              PODIUM[i + 1]?.badge ?? "border-border bg-muted/40",
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{ord(i + 1)}</span>
            <span className="font-display text-base font-bold leading-tight tabular-nums">{p}</span>
          </span>
        ))}
        <span className="inline-flex min-w-16 flex-col items-center rounded-md border border-info/40 bg-info/10 px-1.5 py-0.5 text-info">
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{t("per_finish")}</span>
          <span className="font-display text-base font-bold leading-tight tabular-nums">+{ps.killPoints}</span>
        </span>
      </div>
    </div>
  );
}

function MatchHead({ m, href }: { m: Match; href?: string }) {
  const t = useT(resultsMsg);
  const published = m.status === "PUBLISHED";
  const inner = (
    <span className={cn("flex flex-col items-center gap-1", !published && "opacity-60")}>
      <span className="font-display text-sm font-bold">M{m.number}</span>
      <MapChip map={m.map} className="px-1.5 py-0.5 text-[10px]" />
    </span>
  );
  if (!href) return inner;
  return (
    <Link to={href} className="rounded-lg p-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50" title={t("open_match", { n: m.number, map: MAP_LABELS[m.map] })}>
      {inner}
    </Link>
  );
}

function MatchCell({ v }: { v: StandingsRow["perMatch"][number] | undefined }) {
  const ord = useOrdinal();
  if (!v) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className="font-display text-sm font-bold tabular-nums">{v.totalPoints}</span>
      <span className="whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">
        {v.placement === 1 ? <span className="font-semibold text-warning-foreground dark:text-warning">WWCD</span> : ord(v.placement)} · {v.kills}F
      </span>
    </span>
  );
}

interface StandingsBoardProps {
  standings: SessionStandings;
  /** highlight this team's row (team view) */
  highlightTeamId?: string;
  /** link a match column header somewhere (match center / scorecard); undefined = no link */
  matchHref?: (m: Match) => string | undefined;
}

/** Points table: desktop table with per-match columns, cards on mobile. */
export function StandingsBoard({ standings: s, highlightTeamId, matchHref }: StandingsBoardProps) {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  if (s.rows.length === 0)
    return (
      <EmptyState
        icon={<Trophy />}
        title={t("empty_title")}
        description={published === 0 ? t("standings_empty_none") : t("standings_empty_some")}
      />
    );

  return (
    <div data-tour="standings-table">
      {/* desktop / tablet */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                <th className="border-b px-3 py-2 text-left font-semibold">#</th>
                <th className="border-b px-3 py-2 text-left font-semibold">{t("col_team")}</th>
                {s.matches.map((m) => (
                  <th key={m.id} className="border-b px-2 py-2 text-center font-semibold normal-case tracking-normal">
                    <MatchHead m={m} href={matchHref?.(m)} />
                  </th>
                ))}
                <th className="border-b px-2 py-2 text-center font-semibold" title={t("col_wins_title")}>{t("col_wins")}</th>
                <th className="border-b px-2 py-2 text-center font-semibold">{t("stat_finishes")}</th>
                <th className="border-b px-2 py-2 text-center font-semibold">{t("col_place_pts")}</th>
                <th className="border-b px-2 py-2 text-center font-semibold">{t("finish_pts")}</th>
                <th className="border-b px-3 py-2 text-right font-semibold">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const mine = r.team.id === highlightTeamId;
                return (
                  <tr
                    key={r.teamId}
                    className={cn(
                      "transition-colors hover:bg-accent/40 [&>td]:border-b [&>td]:border-border/60",
                      PODIUM[r.rank]?.row,
                      mine && "bg-primary/10 outline-2 -outline-offset-2 outline-primary/60",
                    )}
                    aria-current={mine ? "true" : undefined}
                  >
                    <td className="px-3 py-2">
                      <RankBadge rank={r.rank} size="sm" />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-44 items-center gap-2.5">
                        <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {r.team.name}
                            {mine && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">{t("you")}</span>}
                          </p>
                          {r.slotNumber != null && <p className="text-xs text-muted-foreground">{t("slot_text", { slot: slotText(r.slotNumber) })}</p>}
                        </div>
                      </div>
                    </td>
                    {s.matches.map((m) => (
                      <td key={m.id} className="px-2 py-2 text-center">
                        <MatchCell v={r.perMatch[m.number]} />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <ChickenDinner count={r.wins} />
                    </td>
                    <td className="px-2 py-2 text-center font-display text-base font-semibold tabular-nums">{r.kills}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">{r.placementPoints}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">{r.killPoints}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-display text-xl font-bold tabular-nums">{r.totalPoints}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile */}
      <ol className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm md:hidden">
        {s.rows.map((r) => {
          const mine = r.team.id === highlightTeamId;
          return (
            <li
              key={r.teamId}
              className={cn("p-3", PODIUM[r.rank]?.row, mine && "bg-primary/10 outline-2 -outline-offset-2 outline-primary/60")}
            >
              <div className="flex items-center gap-3">
                <RankBadge rank={r.rank} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {r.team.name}
                    {mine && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">{t("you")}</span>}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.slotNumber != null && <span>{t("slot_text", { slot: slotText(r.slotNumber) })}</span>}
                    <span className="inline-flex items-center gap-0.5">
                      <Crosshair className="size-3" /> {r.kills}
                    </span>
                    {r.wins > 0 && <ChickenDinner count={r.wins} className="text-xs [&_svg]:size-3" />}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-bold leading-none tabular-nums">{r.totalPoints}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("pts")}</p>
                </div>
              </div>
              {s.matches.length > 0 && (
                <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 pl-11">
                  {s.matches.map((m) => {
                    const v = r.perMatch[m.number];
                    return (
                      <div key={m.id} className="flex min-w-12 flex-col items-center rounded-md bg-muted/50 px-1.5 py-0.5 text-center">
                        <span className="text-[10px] font-semibold text-muted-foreground">M{m.number}</span>
                        {v ? (
                          <>
                            <span className="font-display text-sm font-bold tabular-nums">{v.totalPoints}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {ord(v.placement)} · {v.kills}F
                            </span>
                          </>
                        ) : (
                          <span className="py-1 text-muted-foreground">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Header strip: matches published + copy button. */
export function StandingsSummary({ standings: s, actions }: { standings: SessionStandings; actions?: ReactNode }) {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const fmt = useDateFormat();
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-1">
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{t("matches_published")}</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">
            {published}
            <span className="text-base text-muted-foreground">/{s.matches.length}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{t("teams")}</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{s.rows.length}</dd>
        </div>
        {s.updatedAt && <dd className="pb-1 text-xs text-muted-foreground">{t("last_updated", { when: fmt(s.updatedAt, "d MMM, h:mm a") })}</dd>}
      </dl>
      <div className="flex flex-wrap gap-2">
        {actions}
        <Button variant="outline" onClick={() => void copyStandings(s, t, ord, fmt)} disabled={s.rows.length === 0} data-tour="standings-copy">
          <Copy /> {t("copy_text")}
        </Button>
      </div>
    </div>
  );
}

export function StandingsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 rounded-xl" />
      <div className="space-y-2 rounded-xl border p-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

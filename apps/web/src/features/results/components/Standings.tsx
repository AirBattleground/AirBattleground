import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, Crosshair, ListOrdered, Trophy } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { MAP_LABELS, type PointsSystem, type SessionStandings, type StandingsRow } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { ChickenDinner, ordinal, PODIUM, RankBadge } from "./Rank";

type Match = SessionStandings["matches"][number];

const slotText = (n: number | null) => (n == null ? "" : `#${String(n).padStart(2, "0")}`);

/** Plain-text points table for WhatsApp / Discord. */
export function standingsText(s: SessionStandings): string {
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  const lines = [
    `🏆 ${s.scrim.title} — ${format(parseISO(s.date), "EEE, d MMM")}`,
    `Points table · ${published}/${s.matches.length} matches`,
    "",
  ];
  for (const r of s.rows) {
    const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}.`;
    const wins = r.wins ? ` · ${r.wins}🍗` : "";
    lines.push(`${medal} ${r.team.name}${r.slotNumber != null ? ` (${slotText(r.slotNumber)})` : ""} — ${r.totalPoints} pts · ${r.kills} fin${wins}`);
  }
  lines.push("", `Points: ${pointsSummary(s.pointsSystem)}`);
  return lines.join("\n");
}

export function pointsSummary(ps: PointsSystem): string {
  return `${ps.placement.join("/")} for 1st–${ordinal(ps.placement.length)} · ${ps.killPoints} per finish`;
}

export async function copyStandings(s: SessionStandings) {
  try {
    await navigator.clipboard.writeText(standingsText(s));
    toast.success("Points table copied", { description: "Paste it into WhatsApp or Discord." });
  } catch {
    toast.error("Couldn't copy automatically", { description: "Your browser blocked clipboard access." });
  }
}

/** Legend explaining how points are counted. */
export function PointsLegend({ ps, action, className }: { ps: PointsSystem; action?: ReactNode; className?: string }) {
  return (
    <div data-tour="points-legend" className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <ListOrdered className="size-4 text-primary" /> How points work
        </h3>
        {action}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ps.placement.map((p, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex min-w-14 flex-col items-center rounded-lg border px-2 py-1",
              PODIUM[i + 1]?.badge ?? "border-border bg-muted/40",
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{ordinal(i + 1)}</span>
            <span className="font-display text-lg font-bold leading-tight tabular-nums">{p}</span>
          </span>
        ))}
        <span className="inline-flex min-w-20 flex-col items-center rounded-lg border border-info/40 bg-info/10 px-2 py-1 text-info">
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Per finish</span>
          <span className="font-display text-lg font-bold leading-tight tabular-nums">+{ps.killPoints}</span>
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Places after {ordinal(ps.placement.length)} get 0 placement points. Ties are broken by total points, then chicken dinners, placement points,
        finishes, and finally the better place in the latest match.
      </p>
    </div>
  );
}

function MatchHead({ m, href }: { m: Match; href?: string }) {
  const published = m.status === "PUBLISHED";
  const inner = (
    <span className={cn("flex flex-col items-center gap-1", !published && "opacity-60")}>
      <span className="font-display text-sm font-bold">M{m.number}</span>
      <MapChip map={m.map} className="px-1.5 py-0.5 text-[10px]" />
    </span>
  );
  if (!href) return inner;
  return (
    <Link to={href} className="rounded-lg p-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50" title={`Open match ${m.number} (${MAP_LABELS[m.map]})`}>
      {inner}
    </Link>
  );
}

function MatchCell({ v }: { v: StandingsRow["perMatch"][number] | undefined }) {
  if (!v) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className="font-display text-base font-bold tabular-nums">{v.totalPoints}</span>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
        {v.placement === 1 ? <span className="font-semibold text-warning-foreground dark:text-warning">WWCD</span> : ordinal(v.placement)} · {v.kills}F
      </span>
    </span>
  );
}

export interface StandingsBoardProps {
  standings: SessionStandings;
  /** highlight this team's row (team view) */
  highlightTeamId?: string;
  /** link a match column header somewhere (match center / scorecard); undefined = no link */
  matchHref?: (m: Match) => string | undefined;
}

/** Points table: desktop table with per-match columns, cards on mobile. */
export function StandingsBoard({ standings: s, highlightTeamId, matchHref }: StandingsBoardProps) {
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  if (s.rows.length === 0)
    return (
      <EmptyState
        icon={<Trophy />}
        title="No results yet"
        description={
          published === 0
            ? "The points table fills in as soon as the first match's results are published."
            : "None of the published matches have any teams yet."
        }
      />
    );

  return (
    <div data-tour="standings-table">
      {/* desktop / tablet */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                <th className="border-b px-3 py-2.5 text-left font-semibold">#</th>
                <th className="border-b px-3 py-2.5 text-left font-semibold">Team</th>
                {s.matches.map((m) => (
                  <th key={m.id} className="border-b px-2 py-2 text-center font-semibold normal-case tracking-normal">
                    <MatchHead m={m} href={matchHref?.(m)} />
                  </th>
                ))}
                <th className="border-b px-2 py-2.5 text-center font-semibold" title="Chicken dinners (match wins)">Wins</th>
                <th className="border-b px-2 py-2.5 text-center font-semibold">Finishes</th>
                <th className="border-b px-2 py-2.5 text-center font-semibold">Place pts</th>
                <th className="border-b px-2 py-2.5 text-center font-semibold">Finish pts</th>
                <th className="border-b px-3 py-2.5 text-right font-semibold">Total</th>
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
                    <td className="px-3 py-2.5">
                      <RankBadge rank={r.rank} size="sm" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-44 items-center gap-2.5">
                        <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {r.team.name}
                            {mine && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">YOU</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.slotNumber != null && <span className="font-display font-semibold text-foreground/80">Slot {slotText(r.slotNumber)}</span>}
                            {r.slotNumber != null && " · "}
                            {r.matchesPlayed} played
                          </p>
                        </div>
                      </div>
                    </td>
                    {s.matches.map((m) => (
                      <td key={m.id} className="px-2 py-2 text-center">
                        <MatchCell v={r.perMatch[m.number]} />
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-center">
                      <ChickenDinner count={r.wins} />
                    </td>
                    <td className="px-2 py-2.5 text-center font-display text-base font-semibold tabular-nums">{r.kills}</td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-muted-foreground">{r.placementPoints}</td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-muted-foreground">{r.killPoints}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-display text-2xl font-bold tabular-nums">{r.totalPoints}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile */}
      <ol className="space-y-2 md:hidden">
        {s.rows.map((r) => {
          const mine = r.team.id === highlightTeamId;
          return (
            <li
              key={r.teamId}
              className={cn("rounded-xl border bg-card p-3 shadow-sm", PODIUM[r.rank]?.row, mine && "border-primary/60 bg-primary/10 shadow-glow")}
            >
              <div className="flex items-center gap-3">
                <RankBadge rank={r.rank} />
                <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {r.team.name}
                    {mine && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">YOU</span>}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.slotNumber != null && <span>Slot {slotText(r.slotNumber)}</span>}
                    <span className="inline-flex items-center gap-0.5">
                      <Crosshair className="size-3" /> {r.kills}
                    </span>
                    {r.wins > 0 && <ChickenDinner count={r.wins} className="text-xs [&_svg]:size-3" />}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl font-bold leading-none tabular-nums">{r.totalPoints}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pts</p>
                </div>
              </div>
              {s.matches.length > 0 && (
                <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
                  {s.matches.map((m) => {
                    const v = r.perMatch[m.number];
                    return (
                      <div key={m.id} className="flex min-w-16 flex-col items-center rounded-lg border bg-background/60 px-2 py-1 text-center">
                        <span className="text-[10px] font-semibold text-muted-foreground">M{m.number}</span>
                        {v ? (
                          <>
                            <span className="font-display text-sm font-bold tabular-nums">{v.totalPoints}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {ordinal(v.placement)} · {v.kills}F
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
  const published = s.matches.filter((m) => m.status === "PUBLISHED").length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matches published</p>
          <p className="font-display text-3xl font-bold">
            {published}
            <span className="text-lg text-muted-foreground">/{s.matches.length}</span>
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Teams</p>
          <p className="font-display text-3xl font-bold">{s.rows.length}</p>
        </div>
        {s.updatedAt && (
          <p className="text-xs text-muted-foreground">Last updated {format(parseISO(s.updatedAt), "d MMM, h:mm a")}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions}
        <Button variant="outline" onClick={() => void copyStandings(s)} disabled={s.rows.length === 0} data-tour="standings-copy">
          <Copy /> Copy as text
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

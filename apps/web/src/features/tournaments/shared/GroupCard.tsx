import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Clock, Crosshair, MonitorPlay } from "lucide-react";
import type { AdvancedVia, GroupTeamStatus, TeamSummary } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { PODIUM } from "@/features/results/components/Rank";
import { fmtTime, relDay, slot2 } from "./format";
import { LiveDot, TeamStageBadge } from "./StatusPill";

/** The subset of a group row the card needs (GroupStandingRow satisfies it). */
export interface GroupCardTeam {
  rank: number;
  team: TeamSummary;
  slotNumber: number;
  matchesPlayed: number;
  kills: number;
  totalPoints: number;
  status: GroupTeamStatus;
  advancedVia: AdvancedVia | null;
}

/** The subset of a group the card needs (GroupDetail satisfies it). */
export interface GroupCardGroup {
  id: string;
  name: string;
  lobbyIndex: number | null;
  startsAt: string | null;
  teams: GroupCardTeam[];
  matches?: { status: string; publishedAt: string | null }[];
}

export interface GroupCardProps {
  group: GroupCardGroup;
  /** highlight this team ("YOU") and outline the card */
  highlightTeamId?: string;
  /** draws the qualification line under this rank (top N per group) */
  advancePerGroup?: number;
  /** rows shown before "Show all" (default: all) */
  maxRows?: number;
  /** order rows by slot number instead of standings (e.g. before any match is played) */
  sortBy?: "rank" | "slot";
  /** makes the header a link (e.g. to the stage view) */
  href?: string;
  /** extra content under the table (e.g. match links) */
  footer?: ReactNode;
  className?: string;
}

/** One group/lobby: name, time, lobby, teams with slot numbers + standings and ADVANCED/WILDCARD/OUT/DQ badges. */
export function GroupCard({ group, highlightTeamId, advancePerGroup = 0, maxRows, sortBy, href, footer, className }: GroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const published = group.matches?.filter((m) => !!m.publishedAt || m.status === "PUBLISHED").length ?? 0;
  const total = group.matches?.length ?? 0;
  const played = published > 0 || group.teams.some((t) => t.matchesPlayed > 0);
  const order = sortBy ?? (played ? "rank" : "slot");
  const rows = [...group.teams].sort((a, b) => (order === "rank" ? a.rank - b.rank : a.slotNumber - b.slotNumber));
  const mineIdx = rows.findIndex((r) => r.team.id === highlightTeamId);
  const mine = mineIdx >= 0;
  const limit = maxRows && !expanded ? maxRows : rows.length;
  // always keep the highlighted team visible when collapsed
  const visible = rows.filter((_, i) => i < limit || i === mineIdx);
  const live = total > 0 && published > 0 && published < total;
  const done = total > 0 && published === total;

  const header = (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl border font-display text-2xl font-bold",
          mine ? "border-primary/50 bg-primary text-primary-foreground shadow-glow" : "border-border bg-muted/60",
        )}
        aria-hidden
      >
        {group.name}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-display text-lg leading-tight font-bold">
          Group {group.name}
          {mine && <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-black tracking-wider text-primary-foreground">YOUR GROUP</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {group.startsAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {relDay(group.startsAt)} · {fmtTime(group.startsAt)}
            </span>
          )}
          {group.lobbyIndex != null && (
            <span className="inline-flex items-center gap-1">
              <MonitorPlay className="size-3" /> Lobby {group.lobbyIndex + 1}
            </span>
          )}
          <span>{group.teams.length} teams</span>
        </p>
      </div>
      {total > 0 && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            live ? "border-destructive/30 bg-destructive/10 text-destructive" : done ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
          )}
        >
          {live && <LiveDot className="size-1.5 [&>span]:size-1.5" />}
          {published}/{total}
        </span>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-3.5 shadow-sm transition-shadow sm:p-4",
        mine && "border-primary/50 shadow-glow",
        className,
      )}
      data-group={group.name}
    >
      {href ? (
        <Link to={href} className="-m-1.5 rounded-xl p-1.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {header}
        </Link>
      ) : (
        header
      )}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Teams appear here after the draw.</p>
      ) : (
        <ol className="mt-3 space-y-1" aria-label={`Group ${group.name} ${order === "rank" ? "standings" : "teams"}`}>
          <AnimatePresence initial={false}>
            {visible.map((r, i) => {
              const isMine = r.team.id === highlightTeamId;
              const out = r.status === "ELIMINATED" || r.status === "DISQUALIFIED";
              const showCut = order === "rank" && advancePerGroup > 0 && r.rank === advancePerGroup && i < visible.length - 1;
              const gap = i > 0 && visible[i - 1] && rows.indexOf(visible[i - 1]!) !== rows.indexOf(r) - 1;
              return (
                <motion.li
                  key={r.team.id}
                  layout="position"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {gap && <div className="py-0.5 text-center text-[10px] leading-none text-muted-foreground">⋯</div>}
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm",
                      order === "rank" && played && PODIUM[r.rank]?.row,
                      isMine && "bg-primary/10 ring-1 ring-primary/50",
                      out && "opacity-60",
                    )}
                    aria-current={isMine ? "true" : undefined}
                  >
                    <span
                      className={cn(
                        "w-6 shrink-0 text-center font-display text-sm font-bold tabular-nums",
                        order === "rank" && played && PODIUM[r.rank] ? "" : "text-muted-foreground",
                      )}
                    >
                      {order === "rank" && played ? r.rank : "·"}
                    </span>
                    <span className="w-9 shrink-0 rounded-md bg-muted/70 py-0.5 text-center font-display text-xs font-bold tabular-nums">{slot2(r.slotNumber)}</span>
                    <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" className="size-6 rounded-md text-[8px]" />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate font-medium">{r.team.name}</span>
                      {isMine && <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[9px] font-black text-primary-foreground">YOU</span>}
                    </span>
                    <TeamStageBadge status={r.status} via={r.advancedVia} className="hidden sm:inline-flex" />
                    {played && (
                      <>
                        <span className="hidden w-8 shrink-0 items-center justify-end gap-0.5 text-xs text-muted-foreground tabular-nums sm:flex" title="Finishes">
                          <Crosshair className="size-3" />
                          {r.kills}
                        </span>
                        <span className="w-9 shrink-0 text-right font-display text-base font-bold tabular-nums">{r.totalPoints}</span>
                      </>
                    )}
                    <TeamStageBadge status={r.status} via={r.advancedVia} className="sm:hidden" />
                  </div>
                  {showCut && (
                    <div className="my-1 flex items-center gap-2 text-[9px] font-bold tracking-[0.2em] text-success uppercase" aria-label="Qualification line">
                      <span className="h-px flex-1 border-t border-dashed border-success/50" /> Qualify ▲<span className="h-px flex-1 border-t border-dashed border-success/50" />
                    </div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      {maxRows && rows.length > maxRows && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center justify-center gap-1 self-center rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {expanded ? "Show less" : `Show all ${rows.length}`}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
      {footer && <div className="mt-3 border-t pt-3">{footer}</div>}
    </div>
  );
}

export function GroupCardSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="size-11 animate-pulse rounded-xl bg-muted" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-36 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-lg bg-muted/70" />
        ))}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, MonitorPlay } from "lucide-react";
import { todayInAppTz, type GameMap, type GroupDetail, type MatchStatus, type StageDetail } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { LiveDot } from "../../shared/StatusPill";
import { fmtTime, groupLetter, istDateKey, useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { tShared } from "@/i18n/tournaments";
import { tStage } from "@/i18n/tournamentsHub";

const MATCH_STATUSES = new Set<string>(["SCHEDULED", "LINEUP_REVIEW", "LIVE", "RESULTS_REVIEW", "PUBLISHED"]);

interface Block {
  key: string;
  groupName: string;
  groupId?: string;
  lobbyIndex: number | null;
  start: string;
  matches: { id?: string; number: number; map: GameMap; at: string | null; status?: string; publishedAt?: string | null }[];
}

function blocksOf(d: StageDetail): Block[] {
  if (d.groups.length > 0) {
    return d.groups
      .map<Block | null>((g) => {
        const times = g.matches.map((m) => m.scheduledAt).filter((x): x is string => !!x).sort();
        const start = g.startsAt ?? times[0];
        if (!start) return null;
        return {
          key: g.id,
          groupName: g.name,
          groupId: g.id,
          lobbyIndex: g.lobbyIndex,
          start,
          matches: [...g.matches].sort((a, b) => a.number - b.number).map((m) => ({ id: m.id, number: m.number, map: m.map, at: m.scheduledAt, status: m.status, publishedAt: m.publishedAt })),
        };
      })
      .filter((b): b is Block => !!b);
  }
  return (d.stage.plan?.blocks ?? []).map((b) => ({
    key: `plan-${b.groupIndex}`,
    groupName: groupLetter(b.groupIndex),
    lobbyIndex: b.lobbyIndex,
    start: b.matches[0]?.start ?? `${b.date}T${b.start}:00+05:30`,
    matches: b.matches.map((m) => ({ number: m.number, map: m.map, at: m.start })),
  }));
}

export const matchHref = (tournamentId: string, stageId: string, matchId: string) => `/team/tournaments/${tournamentId}/matches/${matchId}?stage=${stageId}`;

function MatchStatusChip({ status, publishedAt }: { status?: string; publishedAt?: string | null }) {
  const ts = useT(tStage);
  if (!status) return null;
  if (publishedAt || status === "PUBLISHED")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
        <CheckCircle2 className="size-3" /> {ts("results")}
      </span>
    );
  if (status === "LIVE" || status === "LINEUP_REVIEW" || status === "RESULTS_REVIEW")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
        <LiveDot className="size-1.5 [&>span]:size-1.5" /> {status === "RESULTS_REVIEW" ? ts("checking_results") : ts("playing")}
      </span>
    );
  return <span className="text-[11px] text-muted-foreground">{MATCH_STATUSES.has(status) ? ts(`ms_${status as MatchStatus}`) : status}</span>;
}

/** Schedule by day, one block per group (time range, lobby, matches). */
export function StageSchedule({ d, myGroupName }: { d: StageDetail; myGroupName?: string | null }) {
  const ts = useT(tStage);
  const tsh = useT(tShared);
  const { fmtDay, relDay } = useTournamentFormat();
  const today = todayInAppTz();
  const blocks = blocksOf(d).sort((a, b) => a.start.localeCompare(b.start));
  if (blocks.length === 0)
    return <EmptyState icon={<CalendarDays />} title={ts("schedule_soon")} description={ts("schedule_soon_desc")} />;
  const days = new Map<string, Block[]>();
  for (const b of blocks) {
    const k = istDateKey(b.start);
    days.set(k, [...(days.get(k) ?? []), b]);
  }
  return (
    <div className="space-y-6" data-tour="schedule">
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 flex items-baseline gap-2 font-display text-lg font-bold">
            <span className={cn(day === today && "text-primary")}>{relDay(list[0]!.start)}</span>
            {relDay(list[0]!.start) !== fmtDay(list[0]!.start) && <span className="text-sm font-medium text-muted-foreground">{fmtDay(list[0]!.start)}</span>}
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              {ts.plural("groups", list.length)}
            </span>
          </h3>
          <ol className="relative space-y-2 border-l-2 border-border pl-4">
            {list.map((b) => {
              const mine = b.groupName === myGroupName;
              const last = b.matches[b.matches.length - 1]?.at;
              return (
                <li key={b.key} className="relative">
                  <span className={cn("absolute top-4 -left-[23px] size-3 rounded-full border-2 border-background", mine ? "bg-primary" : "bg-muted-foreground/40")} />
                  <div className={cn("rounded-xl border bg-card p-3 shadow-sm", mine && "border-primary/50 bg-primary/5 shadow-glow")}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-display text-xl font-bold tabular-nums">{fmtTime(b.start)}</span>
                      {last && last !== b.start && <span className="text-xs text-muted-foreground">{ts("last_match", { time: fmtTime(last) })}</span>}
                      <span className="font-display text-base font-bold">{tsh("group_name", { name: b.groupName })}</span>
                      {mine && <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-black text-primary-foreground">{tsh("you_tag")}</span>}
                      {b.lobbyIndex != null && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MonitorPlay className="size-3" /> {tsh("lobby_n", { n: b.lobbyIndex + 1 })}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {b.matches.map((m) => {
                        const inner = (
                          <>
                            <span className="font-display text-xs font-bold">M{m.number}</span>
                            <MapChip map={m.map} className="border-0 bg-transparent px-0 py-0 text-[11px]" />
                            {m.at && <span className="text-[11px] text-muted-foreground tabular-nums">{fmtTime(m.at)}</span>}
                          </>
                        );
                        const published = !!m.publishedAt || m.status === "PUBLISHED";
                        return published && m.id ? (
                          <Link
                            key={m.number}
                            to={matchHref(d.tournament.id, d.stage.id, m.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/5 px-2 py-1 outline-none hover:bg-success/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <span key={m.number} className="inline-flex items-center gap-1.5 rounded-lg border bg-background/60 px-2 py-1">
                            {inner}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Every match of the stage by group; published ones open the scorecard. */
export function StageMatches({ d, myGroupName }: { d: StageDetail; myGroupName?: string | null }) {
  const ts = useT(tStage);
  const tsh = useT(tShared);
  const { relDay } = useTournamentFormat();
  const groups: GroupDetail[] = [...d.groups].sort((a, b) => (a.name === myGroupName ? -1 : b.name === myGroupName ? 1 : a.index - b.index));
  if (groups.length === 0 || groups.every((g) => g.matches.length === 0))
    return <EmptyState icon={<Clock />} title={ts("no_matches")} description={ts("no_matches_desc")} />;
  return (
    <div className="grid gap-4 md:grid-cols-2" data-tour="match-list">
      {groups.map((g) => (
        <section key={g.id} className={cn("rounded-2xl border bg-card p-3.5 shadow-sm", g.name === myGroupName && "border-primary/50")}>
          <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
            {tsh("group_name", { name: g.name })}
            {g.name === myGroupName && <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-black text-primary-foreground">{tsh("your_group_tag")}</span>}
          </h3>
          <ol className="divide-y">
            {[...g.matches]
              .sort((a, b) => a.number - b.number)
              .map((m) => {
                const published = !!m.publishedAt || m.status === "PUBLISHED";
                const row = (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-display text-sm font-bold">M{m.number}</span>
                    <span className="min-w-0 flex-1">
                      <MapChip map={m.map} className="px-1.5 py-0.5 text-[11px]" />
                      <span className="mt-0.5 block text-xs text-muted-foreground">{m.scheduledAt ? `${relDay(m.scheduledAt)} · ${fmtTime(m.scheduledAt)}` : ts("time_tba")}</span>
                    </span>
                    <MatchStatusChip status={m.status} publishedAt={m.publishedAt} />
                    {published && <ChevronRight className="size-4 text-muted-foreground" />}
                  </>
                );
                return (
                  <li key={m.id}>
                    {published ? (
                      <Link
                        to={matchHref(d.tournament.id, d.stage.id, m.id)}
                        className="-mx-1.5 flex items-center gap-3 rounded-lg px-1.5 py-2 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {row}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 py-2">{row}</div>
                    )}
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </div>
  );
}

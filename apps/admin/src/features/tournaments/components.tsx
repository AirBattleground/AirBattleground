import { Fragment, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Ban, CheckCircle2, CircleDot, ClipboardList, Crown, Hourglass, Lock, PencilLine, Radio, Trophy } from "lucide-react";
import {
  TOURNAMENT_STATUS_LABELS,
  type GroupDetail,
  type GroupTeamStatus,
  type StageStatus,
  type StageSummary,
  type TournamentDetail,
  type TournamentStatus,
} from "@7xen/shared";
import { Pill, TeamAvatar, type Tone } from "@7xen/ui/components/brand/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@7xen/ui/components/ui/table";
import { cn } from "@7xen/ui/lib/utils";

const STATUS_META: Record<TournamentStatus, { tone: Tone; icon: ReactNode }> = {
  DRAFT: { tone: "neutral", icon: <PencilLine className="size-3.5" /> },
  REGISTRATION_OPEN: { tone: "success", icon: <ClipboardList className="size-3.5" /> },
  REGISTRATION_CLOSED: { tone: "warning", icon: <Lock className="size-3.5" /> },
  LIVE: { tone: "brand", icon: <Radio className="size-3.5" /> },
  COMPLETED: { tone: "info", icon: <Trophy className="size-3.5" /> },
  CANCELLED: { tone: "danger", icon: <Ban className="size-3.5" /> },
};

export function TournamentStatusPill({ status, className }: { status: TournamentStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {TOURNAMENT_STATUS_LABELS[status]}
    </Pill>
  );
}

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = { PENDING: "Not drawn", DRAWN: "Groups drawn", LIVE: "Playing", COMPLETED: "Finished" };
const STAGE_TONE: Record<StageStatus, Tone> = { PENDING: "neutral", DRAWN: "warning", LIVE: "brand", COMPLETED: "success" };

export function StageStatusPill({ status }: { status: StageStatus }) {
  return <Pill tone={STAGE_TONE[status]}>{STAGE_STATUS_LABELS[status]}</Pill>;
}

const GT_META: Record<GroupTeamStatus, { tone: Tone; label: string }> = {
  ACTIVE: { tone: "neutral", label: "Playing" },
  ADVANCED: { tone: "success", label: "Qualified" },
  ELIMINATED: { tone: "danger", label: "Out" },
  DISQUALIFIED: { tone: "danger", label: "Disqualified" },
};

/** "8 × 16" style description of a stage. */
export function stageShape(s: Pick<StageSummary, "groupCount" | "lobbySize" | "matchesPerGroup">) {
  return `${s.groupCount} ${s.groupCount === 1 ? "lobby" : "groups"} × ${s.lobbySize} · ${s.matchesPerGroup} ${s.matchesPerGroup === 1 ? "match" : "matches"}`;
}

export function advanceText(s: StageSummary, isLast: boolean) {
  if (isLast) return "Winner takes the title";
  const parts = [`Top ${s.advancePerGroup}${s.groupCount > 1 ? " per group" : ""}`];
  if (s.wildcardCount) parts.push(`${s.wildcardCount} wildcard${s.wildcardCount === 1 ? "" : "s"}`);
  return `${parts.join(" + ")} → ${s.teamsOut}`;
}

/** The stage the tournament is "at": first non-completed stage once registration is done. */
export function currentStageIndex(t: Pick<TournamentDetail, "stages" | "status">): number {
  if (t.status === "DRAFT" || t.status === "REGISTRATION_OPEN") return -1;
  const i = t.stages.findIndex((s) => s.status !== "COMPLETED");
  return i === -1 ? t.stages.length : i;
}

function FlowArrow() {
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center text-primary/60">
      <ArrowDown className="size-4 md:hidden" />
      <ArrowRight className="hidden size-4 md:block" />
    </div>
  );
}

function FlowNode({ active, done, title, sub, foot, icon }: { active: boolean; done: boolean; title: ReactNode; sub: ReactNode; foot?: ReactNode; icon: ReactNode }) {
  return (
    <div
      className={cn(
        "relative min-w-0 flex-1 rounded-xl border bg-card p-3 transition-colors md:min-w-[9.5rem]",
        active && "border-primary/60 bg-primary/5 shadow-glow",
        done && "border-success/40",
      )}
    >
      {active && <span aria-hidden className="absolute -top-1 -right-1 size-3 animate-pulse rounded-full border-2 border-card bg-primary" />}
      <div className="flex items-center gap-2">
        <span className={cn("[&_svg]:size-4", active ? "text-primary" : done ? "text-success" : "text-muted-foreground")}>{icon}</span>
        <span className="truncate font-display text-base font-bold">{title}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      {foot && <div className="mt-2">{foot}</div>}
    </div>
  );
}

/** Compact registration → stages → champion chain. Vertical on phones, horizontal from md. */
export function StageFlow({ t }: { t: TournamentDetail }) {
  const cur = currentStageIndex(t);
  const regOpen = t.status === "REGISTRATION_OPEN";
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        <FlowNode
          active={regOpen}
          done={cur >= 0}
          icon={<ClipboardList />}
          title="Registration"
          sub={
            <>
              <strong className="font-display text-sm text-foreground">{t.confirmedCount}</strong> / {t.maxTeams} confirmed
              {t.waitlistCount > 0 && <> · {t.waitlistCount} waiting</>}
            </>
          }
        />
        {t.stages.map((s, i) => {
          const isLast = i === t.stages.length - 1;
          return (
            <Fragment key={s.id}>
              <FlowArrow />
              <FlowNode
                active={i === cur && t.status !== "CANCELLED"}
                done={s.status === "COMPLETED"}
                icon={s.status === "COMPLETED" ? <CheckCircle2 /> : s.status === "LIVE" ? <Radio /> : s.status === "DRAWN" ? <CircleDot /> : <Hourglass />}
                title={s.name}
                sub={
                  <>
                    <span className="block">{s.teamsIn} teams · {stageShape(s)}</span>
                    <span className="block">{advanceText(s, isLast)}</span>
                    {s.invitedSlots > 0 && <span className="block">+{s.invitedSlots} invited</span>}
                  </>
                }
                foot={<StageStatusPill status={s.status} />}
              />
            </Fragment>
          );
        })}
        <FlowArrow />
        <FlowNode
          active={t.status === "COMPLETED"}
          done={!!t.champion}
          icon={<Crown />}
          title="Champion"
          sub={t.champion ? <span className="font-semibold text-foreground">{t.champion.name}</span> : "To be decided"}
        />
      </div>
    </div>
  );
}

/** Standings of one group (ranked rows from the API). */
/** `isFinal`: the last stage — rank 1 reads "Champion", everyone else "Finished" (not "Out"). */
export function GroupTable({ group, isFinal = false }: { group: GroupDetail; isFinal?: boolean }) {
  const played = group.matches.filter((m) => m.publishedAt).length;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 className="font-display text-lg font-bold">Group {group.name}</h3>
        <span className="text-xs text-muted-foreground">
          {group.teams.length} teams · {played}/{group.matches.length} matches published
          {group.lobbyIndex != null && <> · Lobby {group.lobbyIndex + 1}</>}
        </span>
      </header>
      {group.teams.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No teams in this group yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Slot</TableHead>
                <TableHead className="hidden text-right sm:table-cell">MP</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Wins</TableHead>
                <TableHead className="text-right">Kills</TableHead>
                <TableHead className="text-right">Pts</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.teams.map((r) => {
                const meta = isFinal && r.status === "ADVANCED" ? { tone: "brand" as Tone, label: "Champion" } : isFinal && r.status === "ELIMINATED" ? { tone: "neutral" as Tone, label: "Finished" } : GT_META[r.status];
                return (
                  <TableRow key={r.team.id}>
                    <TableCell className="pl-4 font-display font-bold">{r.rank}</TableCell>
                    <TableCell>
                      <div className="flex min-w-[8rem] items-center gap-2">
                        <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                        <span className="truncate font-medium">{r.team.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right font-display sm:table-cell">{r.slotNumber}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{r.matchesPlayed}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{r.wins}</TableCell>
                    <TableCell className="text-right">{r.kills}</TableCell>
                    <TableCell className="text-right font-display text-base font-bold">{r.totalPoints}</TableCell>
                    <TableCell className="pr-4">
                      <Pill tone={meta.tone}>
                        {meta.label}
                        {r.advancedVia === "WILDCARD" && " (wildcard)"}
                      </Pill>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  Clock,
  Crosshair,
  Hash,
  Loader2,
  Play,
  Save,
  Shuffle,
  Trophy,
  TrendingUp,
} from "lucide-react";
import {
  DEFAULT_SCHEDULE,
  MAP_LABELS,
  scheduleConfigSchema,
  todayInAppTz,
  addDays,
  type GameMap,
  type GroupDetail,
  type GroupMatchRow,
  type MatchStatus,
  type ScheduleConfig,
  type StageDetail,
  type StageSpec,
} from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { MapChip } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { MatchStatusPill } from "@/features/matches/components/MatchStatusPill";
import { useDraw, useSaveSchedule, useStage, useStartStage, useTournament } from "@/features/tournaments/manager/api";
import { planSchedule } from "@/features/tournaments/manager/engine";
import { DrawReveal } from "@/features/tournaments/manager/components/DrawReveal";
import { Advanced } from "@/features/tournaments/manager/components/form";
import { DisqualifyDialog, MoveTeamDialog, RescheduleMatchDialog } from "@/features/tournaments/manager/components/GroupTools";
import { PromotionPanel } from "@/features/tournaments/manager/components/PromotionPanel";
import { Zone } from "@/features/tournaments/manager/components/Zone";
import { ScheduleEditor } from "@/features/tournaments/manager/components/ScheduleEditor";
import { SchedulePreview } from "@/features/tournaments/manager/components/SchedulePreview";
import { fmtRange, fmtTime, fmtWhen } from "@/features/tournaments/shared/format";
import { GroupCard, GroupCardSkeleton } from "@/features/tournaments/shared/GroupCard";
import { StageFlow } from "@/features/tournaments/shared/StageFlow";
import { StatusPill } from "@/features/tournaments/shared/StatusPill";

const TOUR: TourStep[] = [
  { title: "Running a stage", description: "Schedule it, draw the groups, start it, play the matches, then promote the best teams." },
  { element: '[data-tour="s-primary"]', title: "Main action", description: "The button for what this stage needs next — draw groups, start the stage or promote teams." },
  { element: '[data-tour="s-tabs"]', title: "Groups, schedule, promotion", description: "Groups shows every lobby with its teams, times and matches. Schedule sets the days and hours. Promotion decides who goes through." },
  { element: '[data-tour="s-groups"]', title: "Groups", description: "Each card is one lobby: slot numbers, live standings and its matches. “Open” takes you to the match center to enter results." },
  { element: '[data-tour="s-tools"]', title: "Fix things", description: "Swap teams between groups, disqualify a team or move a match to a new time." },
  { element: '[data-tour="s-schedule"]', title: "Schedule", description: "Days, playing hours and lobbies. The preview shows each group's time block." },
  { element: '[data-tour="t-promotion"]', title: "Who goes through", description: "Top teams per group plus wildcards. Settle ties with Force in / Force out, then promote." },
];

type Tab = "groups" | "schedule" | "promotion";

export default function StagePage() {
  usePageTour("manager.tournamentStage", TOUR);
  const { tournamentId = "", stageId = "" } = useParams();
  const q = useStage(tournamentId, stageId);
  const t = useTournament(tournamentId);
  const back = `/manager/tournaments/${tournamentId}?tab=stages`;
  if (q.isError)
    return (
      <>
        <BackLink to={back} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this stage" />
      </>
    );
  if (!q.data) return <StageSkeleton />;
  return <StageView key={q.data.stage.id} s={q.data} stages={t.data?.stages} firstSlot={t.data?.firstSlot} back={back} />;
}

function BackLink({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={to}>
        <ArrowLeft /> Back to tournament
      </Link>
    </Button>
  );
}

function StageView({ s, stages, back }: { s: StageDetail; stages?: StageDetail["stage"][]; firstSlot?: number; back: string }) {
  const [params, setParams] = useSearchParams();
  const st = s.stage;
  const tId = s.tournament.id;
  const isLast = !!stages && st.order === stages.length;
  const defaultTab: Tab = st.status === "PENDING" ? "schedule" : "groups";
  const raw = params.get("tab");
  const tab: Tab = raw === "groups" || raw === "schedule" || raw === "promotion" ? raw : defaultTab;
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    next.delete("draw");
    setParams(next, { replace: true });
  };

  const draw = useDraw(tId, st.id);
  const start = useStartStage(tId, st.id);
  const [drawOpen, setDrawOpen] = useState(params.get("draw") === "1" && st.status === "PENDING");
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reveal, setReveal] = useState<StageDetail | null>(null);

  const doDraw = (seed: string | undefined, redraw: boolean) =>
    draw.mutate(
      { seed: seed || undefined, redraw },
      {
        onSuccess: (res) => {
          setDrawOpen(false);
          setRedrawOpen(false);
          setReveal(res);
          const next = new URLSearchParams(params);
          next.set("tab", "groups");
          next.delete("draw");
          setParams(next, { replace: true });
        },
      },
    );

  const anyResults = s.groups.some((g) => g.matches.some((m) => m.status !== "SCHEDULED"));

  const primary =
    st.status === "PENDING" ? (
      <Button size="lg" data-tour="s-primary" onClick={() => setDrawOpen(true)} className="shadow-glow">
        <Shuffle /> Draw groups
      </Button>
    ) : st.status === "DRAWN" ? (
      <Button size="lg" data-tour="s-primary" onClick={() => setStarting(true)} disabled={start.isPending} className="shadow-glow">
        {start.isPending ? <Loader2 className="animate-spin" /> : <Play />} Start {st.name}
      </Button>
    ) : st.status === "LIVE" ? (
      <Button size="lg" data-tour="s-primary" variant={tab === "promotion" ? "outline" : "default"} onClick={() => setTab("promotion")} className={cn(tab !== "promotion" && "shadow-glow")}>
        {isLast ? <Trophy /> : <TrendingUp />} {isLast ? "Final results" : "Who goes through?"}
      </Button>
    ) : null;

  return (
    <>
      <BackLink to={back} />
      <PageHeader
        eyebrow={`${s.tournament.title} · Stage ${st.order}`}
        title={st.name}
        description={`${st.teamsIn} teams · ${st.groupCount > 1 ? `${st.groupCount} groups × ${st.lobbySize}` : "1 lobby"} · ${st.matchesPerGroup} matches${isLast ? " · decides the champion" : ` · top ${st.advancePerGroup}${st.groupCount > 1 ? "/group" : ""}${st.wildcardCount ? ` + ${st.wildcardCount}` : ""} go through`}`}
        actions={
          <>
            <StatusPill kind="stage" status={st.status} className="text-sm" />
            {st.status === "DRAWN" && (
              <Button variant="outline" onClick={() => setRedrawOpen(true)} disabled={anyResults}>
                <Shuffle /> Redraw
              </Button>
            )}
            {primary}
          </>
        }
      />

      <div className="space-y-6">
        <Zone label="This stage" bodyClassName="space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" /> {st.startsAt ? fmtRange(st.startsAt, st.endsAt) : st.schedule ? "Scheduled" : "Not scheduled yet"}
            </span>
            {st.plan && (
              <span className="text-muted-foreground">
                {st.plan.days} {st.plan.days === 1 ? "day" : "days"}
              </span>
            )}
            {st.drawSeed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex cursor-help items-center gap-1 text-xs text-muted-foreground">
                    <Hash className="size-3.5" /> <span className="font-mono">{st.drawSeed}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">Draw seed — the same seed always gives the same groups, so anyone can check the draw was fair.</TooltipContent>
              </Tooltip>
            )}
            <span className="flex flex-wrap gap-1.5 sm:ml-auto">
              {st.maps.map((m, i) => (
                <MapChip key={i} map={m} index={i} />
              ))}
            </span>
          </div>
          {stages && stages.length > 1 && (
            <div className="border-t pt-4">
              <StageFlow stages={stages} selectedStageId={st.id} stageHref={(x) => (x.id === st.id ? undefined : `/manager/tournaments/${tId}/stages/${x.id}`)} />
            </div>
          )}
        </Zone>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList data-tour="s-tabs" className="grid h-10 w-full grid-cols-3 sm:inline-flex sm:w-auto">
            <TabsTrigger value="groups" className="px-3 sm:px-4">
Groups
            </TabsTrigger>
            <TabsTrigger value="schedule" className="px-3 sm:px-4">
Schedule
            </TabsTrigger>
            <TabsTrigger value="promotion" className="px-3 sm:px-4">
              {isLast ? "Results" : "Promotion"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="groups" className="mt-4">
            <GroupsTab s={s} onDraw={() => setDrawOpen(true)} />
          </TabsContent>
          <TabsContent value="schedule" className="mt-4">
            <ScheduleTab s={s} />
          </TabsContent>
          <TabsContent value="promotion" className="mt-4">
            <PromotionPanel stage={s} />
          </TabsContent>
        </Tabs>
      </div>

      <DrawDialog open={drawOpen} onOpenChange={setDrawOpen} s={s} busy={draw.isPending} onDraw={(seed) => doDraw(seed, false)} />
      <DrawDialog open={redrawOpen} onOpenChange={setRedrawOpen} s={s} busy={draw.isPending} onDraw={(seed) => doDraw(seed, true)} redraw />
      <ConfirmDialog
        open={starting}
        onOpenChange={setStarting}
        title={`Start the ${st.name}?`}
        description="The stage goes live: registration closes for good and you can enter match results. Group changes are still possible until the first result is in."
        confirmLabel="Start stage"
        onConfirm={() => start.mutate()}
      />
      <AnimatePresence>{reveal && <DrawReveal groups={reveal.groups} seed={reveal.stage.drawSeed} stageName={reveal.stage.name} onDone={() => setReveal(null)} />}</AnimatePresence>
    </>
  );
}

function DrawDialog({ open, onOpenChange, s, busy, onDraw, redraw }: { open: boolean; onOpenChange: (o: boolean) => void; s: StageDetail; busy: boolean; onDraw: (seed?: string) => void; redraw?: boolean }) {
  const [seed, setSeed] = useState("");
  useEffect(() => {
    if (open) setSeed("");
  }, [open]);
  const st = s.stage;
  const first = st.order === 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Shuffle className="size-5 text-primary" /> {redraw ? "Redraw the groups?" : `Draw the ${st.name} groups`}
          </DialogTitle>
          <DialogDescription>
            {first ? "Teams get their best time slot with room, in sign-up order." : "Teams are seeded by their previous-stage results."}
            {redraw && " Current groups and match times are replaced."}
          </DialogDescription>
        </DialogHeader>
        {!st.schedule && (
          <p className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
            <CalendarX2 className="mt-0.5 size-4 shrink-0" /> No schedule yet — groups won't get match times. Set one in the Schedule tab first.
          </p>
        )}
        <Advanced title="Draw seed" hint="Leave empty for a random seed">
          <div className="space-y-2">
            <Label htmlFor="draw-seed">Seed</Label>
            <Input id="draw-seed" value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={40} placeholder="e.g. winter-cup-2026" className="font-mono" />
          </div>
        </Advanced>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onDraw(seed.trim() || undefined)} disabled={busy} variant={redraw ? "destructive" : "default"}>
            {busy ? <Loader2 className="animate-spin" /> : <Shuffle />} {redraw ? "Redraw" : "Draw now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupsTab({ s, onDraw }: { s: StageDetail; onDraw: () => void }) {
  const st = s.stage;
  const [moving, setMoving] = useState(false);
  const [dq, setDq] = useState(false);
  const [resched, setResched] = useState<{ match: GroupMatchRow; group: GroupDetail } | null>(null);
  const editable = st.status === "DRAWN" || st.status === "LIVE";
  const noResults = !s.groups.some((g) => g.matches.some((m) => m.status !== "SCHEDULED"));
  const base = `/manager/tournaments/${s.tournament.id}/stages/${st.id}/matches`;

  if (st.status === "PENDING" || s.groups.length === 0)
    return (
      <EmptyState
        icon={<Shuffle />}
        title="Groups haven't been drawn yet"
        description={st.order === 1 ? "Close registration, then draw the groups." : "Promote the previous stage, then draw the groups."}
        action={
          st.status === "PENDING" && (
            <Button onClick={onDraw}>
              <Shuffle /> Draw groups
            </Button>
          )
        }
      />
    );

  return (
    <div className="space-y-5">
      {s.unmetPreferences.length > 0 && (
        <Advanced
          title={`${s.unmetPreferences.length} team${s.unmetPreferences.length === 1 ? "" : "s"} didn't get their preferred time`}
          hint="Their chosen slots were full by the time their sign-up came up"
          className="border-warning/50 bg-warning/10"
        >
          <ul className="space-y-1.5">
            {s.unmetPreferences.map((u) => (
              <li key={u.team.id} className="flex flex-wrap items-center gap-2 text-sm">
                <TeamAvatar name={u.team.name} tag={u.team.tag} size="sm" className="size-6 text-[8px]" />
                <span className="font-medium">{u.team.name}</span>
                <span className="text-muted-foreground">
                  wanted {u.wanted.map((w) => fmtWhen(w)).join(" or ")} → got {u.got ? fmtWhen(u.got) : "no slot"}
                </span>
              </li>
            ))}
          </ul>
        </Advanced>
      )}

      {editable && (
        <div data-tour="s-tools" className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setMoving(true)} disabled={!noResults}>
            <ArrowLeftRight /> Change groups
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDq(true)} className="text-destructive hover:text-destructive">
            <Ban /> Disqualify a team
          </Button>
          {!noResults && <span className="self-center text-xs text-muted-foreground">Groups are locked once results are in.</span>}
        </div>
      )}

      <div data-tour="s-groups" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[...s.groups]
          .sort((a, b) => a.index - b.index)
          .map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              advancePerGroup={st.advancePerGroup}
              footer={
                <ul className="space-y-1">
                  {g.matches.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <span className="w-7 shrink-0 font-display font-bold text-muted-foreground">M{m.number}</span>
                      <span className="min-w-0 flex-1 truncate">{MAP_LABELS[m.map as GameMap] ?? m.map}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{m.scheduledAt ? fmtTime(m.scheduledAt) : "—"}</span>
                      <MatchStatusPill status={m.status as MatchStatus} className="hidden px-2 text-[10px] sm:inline-flex" />
                      {editable && m.status === "SCHEDULED" && (
                        <Button variant="ghost" size="icon-xs" aria-label={`Reschedule match ${m.number} of group ${g.name}`} onClick={() => setResched({ match: m, group: g })}>
                          <Clock />
                        </Button>
                      )}
                      <Button asChild variant={m.status === "PUBLISHED" ? "ghost" : "outline"} size="xs">
                        <Link to={`${base}/${m.id}`} aria-label={`Open match center for group ${g.name} match ${m.number}`}>
                          Open <ChevronRight />
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              }
            />
          ))}
      </div>

      {(s.topTeams.length > 0 || s.topFraggers.length > 0) && <Leaders s={s} />}

      <MoveTeamDialog stage={s} open={moving} onOpenChange={setMoving} />
      <DisqualifyDialog stage={s} open={dq} onOpenChange={setDq} />
      <RescheduleMatchDialog stage={s} match={resched?.match ?? null} group={resched?.group ?? null} onOpenChange={(o) => !o && setResched(null)} />
    </div>
  );
}

function Leaders({ s }: { s: StageDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
          <TrendingUp className="size-4 text-primary" /> Top teams
        </h3>
        <ol className="space-y-1">
          {s.topTeams.slice(0, 8).map((t, i) => (
            <li key={t.team.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-center font-display font-bold text-muted-foreground">{i + 1}</span>
              <TeamAvatar name={t.team.name} tag={t.team.tag} size="sm" className="size-6 text-[8px]" />
              <span className="min-w-0 flex-1 truncate">{t.team.name}</span>
              <span className="text-xs text-muted-foreground">Grp {t.groupName}</span>
              <span className="w-14 text-right font-display font-bold">{t.pointsPerMatch.toFixed(1)}/m</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
          <Crosshair className="size-4 text-primary" /> Top fraggers
        </h3>
        <ol className="space-y-1">
          {s.topFraggers.slice(0, 8).map((f, i) => (
            <li key={`${f.team.id}-${f.name}`} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-center font-display font-bold text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              <span className="truncate text-xs text-muted-foreground">{f.team.name}</span>
              <span className="w-10 text-right font-display font-bold">{f.kills}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ScheduleTab({ s }: { s: StageDetail }) {
  const st = s.stage;
  const save = useSaveSchedule(s.tournament.id, st.id);
  const editable = st.status === "PENDING" || st.status === "DRAWN";
  const initial = useMemo<ScheduleConfig>(
    () => st.schedule ?? { ...DEFAULT_SCHEDULE, windows: DEFAULT_SCHEDULE.windows.map((w) => ({ ...w })), startDate: addDays(todayInAppTz(), 1), endDate: addDays(todayInAppTz(), 2) },
    [st.schedule],
  );
  const [cfg, setCfg] = useState<ScheduleConfig>(initial);
  useEffect(() => setCfg(initial), [initial]);
  const spec: StageSpec = { ...st, schedule: cfg };
  const plan = useMemo(() => planSchedule(cfg, spec), [cfg, st.teamsIn, st.groupCount, st.matchesPerGroup, st.maps]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = scheduleConfigSchema.safeParse(cfg);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(st.schedule);
  const errors = check.success
    ? undefined
    : {
        startDate: check.error.issues.find((i) => i.path[0] === "startDate")?.message,
        endDate: check.error.issues.find((i) => i.path[0] === "endDate")?.message,
        windows: check.error.issues.find((i) => i.path[0] === "windows")?.message,
      };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-tour="s-schedule">
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold">Schedule</h3>
            {(st.status === "DRAWN" || !editable) && (
              <p className="text-sm text-muted-foreground">
                {editable ? "Saving moves the drawn groups' match times." : "Stage started — move single matches from the Groups tab."}
              </p>
            )}
          </div>
        </div>
        <ScheduleEditor value={cfg} onChange={setCfg} errors={errors} disabled={!editable} />
        {editable && (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {dirty && st.schedule && (
              <Button variant="ghost" onClick={() => setCfg(initial)}>
                Undo changes
              </Button>
            )}
            <Button onClick={() => save.mutate(cfg)} disabled={!check.success || !dirty || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save schedule
            </Button>
          </div>
        )}
      </section>
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">{dirty ? "Preview (not saved)" : "Plan"}</p>
        <p className="mb-4 font-display text-lg font-bold">
          {st.groupCount} groups × {st.matchesPerGroup} matches
        </p>
        <SchedulePreview plan={plan} config={cfg} groupCount={st.groupCount} onApply={editable ? setCfg : undefined} showSlots={st.order === 1} />
      </section>
    </div>
  );
}

function StageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-14 rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <GroupCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

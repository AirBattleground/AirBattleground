import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, CalendarDays, Grid3x3, Info, ListChecks, SearchX, Shuffle } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { ordinal } from "@/features/results/components/Rank";
import { QueryError } from "@/features/team/components/QueryError";
import { GroupCard, GroupCardSkeleton } from "@/features/tournaments/shared/GroupCard";
import { StageFlow } from "@/features/tournaments/shared/StageFlow";
import { StatusPill } from "@/features/tournaments/shared/StatusPill";
import { fmtWhen, plural } from "@/features/tournaments/shared/format";
import { useTeamStage, useTeamTournament } from "@/features/tournaments/team/api";
import { OnFire } from "@/features/tournaments/team/components/HubSections";
import { StageMatches, StageSchedule } from "@/features/tournaments/team/components/StageSections";
import { slotLabel, youFromMe } from "@/features/tournaments/team/journey";

const STEPS: TourStep[] = [
  { title: "Stage view", description: "Everything about this stage: the groups, when each group plays, live standings and every match." },
  { element: '[data-tour="my-group"]', title: "Your group", description: "Your group, slot number and current rank. Tap to jump straight to your group's table.", side: "bottom" },
  { element: '[data-tour="on-fire"]', title: "Who's on fire", description: "Top teams by points per match across all groups, and the top fraggers.", side: "top" },
  { element: '[data-tour="stage-tabs"]', title: "Groups, schedule, matches", description: "Switch between the group tables, the day-by-day schedule and the list of matches.", side: "bottom" },
  { element: '[data-tour="group-grid"]', title: "Group tables", description: "Slot numbers and live points. Teams above the dashed line are in a qualifying spot; badges show who advanced, got a wildcard or is out.", side: "top" },
];

type Tab = "groups" | "schedule" | "matches";

export default function StagePage() {
  usePageTour("team.tournament-stage", STEPS);
  const { id = "", stageId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (["groups", "schedule", "matches"].includes(params.get("tab") ?? "") ? params.get("tab") : "groups") as Tab;
  const { user } = useAuth();
  const myId = user?.team?.id;
  const tq = useTeamTournament(id);
  const q = useTeamStage(id, stageId);
  const d = q.data;
  const t = tq.data;
  const you = useMemo(() => (t ? youFromMe(t.me, user?.team, t) : null), [t, user?.team]);

  const myGroup = d?.groups.find((g) => g.teams.some((r) => r.team.id === myId)) ?? null;
  const myRow = myGroup?.teams.find((r) => r.team.id === myId) ?? null;
  const myUnmet = d?.unmetPreferences.find((u) => u.team.id === myId);
  const groups = useMemo(
    () => (d ? [...d.groups].sort((a, b) => (a.id === myGroup?.id ? -1 : b.id === myGroup?.id ? 1 : a.index - b.index)) : []),
    [d, myGroup?.id],
  );
  const anyPlayed = d?.groups.some((g) => g.teams.some((r) => r.matchesPlayed > 0)) ?? false;

  const jumpToMine = () => {
    setParams(tab === "groups" ? params : {}, { replace: true });
    requestAnimationFrame(() => document.querySelector(`[data-group="${myGroup?.name}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 max-w-full text-muted-foreground">
      <Link to={`/team/tournaments/${id}`}>
        <ArrowLeft /> <span className="truncate">{d?.tournament.title ?? t?.title ?? "Tournament"}</span>
      </Link>
    </Button>
  );

  if (q.isError)
    return (
      <>
        {back}
        {q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403) ? (
          <EmptyState icon={<SearchX />} title="Stage not found" description="This stage may have been changed by the organiser." />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this stage" />
        )}
      </>
    );

  if (!d)
    return (
      <>
        {back}
        <Skeleton className="mb-2 h-4 w-40" />
        <Skeleton className="mb-6 h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <GroupCardSkeleton key={i} />
          ))}
        </div>
      </>
    );

  const s = d.stage;
  const last = t ? t.stages[t.stages.length - 1]?.id === s.id : s.advancePerGroup === 0;
  const advance = last
    ? "Winner takes the trophy"
    : `Top ${s.advancePerGroup}${s.groupCount > 1 ? " per group" : ""}${s.wildcardCount ? ` + ${s.wildcardCount} wildcards` : ""} advance`;

  return (
    <>
      {back}
      <PageHeader
        eyebrow={d.tournament.title}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.name} <StatusPill kind="stage" status={s.status} className="text-sm" />
          </span>
        }
        description={`${s.teamsIn} teams · ${s.groupCount > 1 ? `${s.groupCount} groups` : "1 lobby"} · ${plural(s.matchesPerGroup, "match", "matches")} each · ${advance}`}
      />

      <div className="space-y-5">
        {t && (
          <section className="rounded-2xl border bg-card px-3 pb-2 shadow-sm sm:px-4" aria-label="All stages">
            <StageFlow
              stages={t.stages}
              champion={t.champion}
              you={you}
              selectedStageId={s.id}
              stageHref={(x) => (x.id === s.id ? undefined : `/team/tournaments/${t.id}/stages/${x.id}`)}
              className="pt-2 md:pt-0"
            />
          </section>
        )}

        {myGroup && myRow && (
          <button
            type="button"
            onClick={jumpToMine}
            data-tour="my-group"
            className="flex w-full items-center gap-4 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-left shadow-glow outline-none transition-colors hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SlotChip slot={myRow.slotNumber} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold tracking-[0.2em] text-primary uppercase">Your group</span>
              <span className="block font-display text-2xl leading-tight font-bold">Group {myGroup.name}</span>
              <span className="block text-sm text-muted-foreground">
                {anyPlayed ? `${ordinal(myRow.rank)} · ${myRow.totalPoints} pts after ${plural(myRow.matchesPlayed, "match", "matches")}` : `Starts ${fmtWhen(myGroup.startsAt)}`}
              </span>
            </span>
            <ArrowDown className="size-5 shrink-0 text-primary" />
          </button>
        )}

        {myUnmet && t && (
          <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
            <span>
              Your preferred time slots were full, so the draw placed you {myUnmet.got ? `at ${slotLabel(t, myUnmet.got)}` : "where there was space"}.
            </span>
          </p>
        )}

        <OnFire stage={d} />

        <Tabs value={tab} onValueChange={(v) => setParams(v === "groups" ? {} : { tab: v }, { replace: true })} className="gap-4">
          <TabsList className="h-10" data-tour="stage-tabs">
            <TabsTrigger value="groups" className="gap-1.5 px-3">
              <Grid3x3 className="size-4" /> Groups
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1.5 px-3">
              <CalendarDays className="size-4" /> Schedule
            </TabsTrigger>
            <TabsTrigger value="matches" className="gap-1.5 px-3">
              <ListChecks className="size-4" /> Matches
            </TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            {groups.length === 0 ? (
              <EmptyState
                icon={<Shuffle />}
                title="Groups haven't been drawn yet"
                description={
                  s.order === 1
                    ? "The organiser draws the groups after registration closes. Check the Schedule tab for the planned time slots."
                    : "Groups are seeded from the previous stage's results once it finishes."
                }
              />
            ) : (
              <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-tour="group-grid">
                {groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    highlightTeamId={myId}
                    advancePerGroup={last ? 0 : s.advancePerGroup}
                    maxRows={g.teams.length > 10 ? 8 : undefined}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="schedule">
            <StageSchedule d={d} myGroupName={myGroup?.name} />
          </TabsContent>
          <TabsContent value="matches">
            <StageMatches d={d} myGroupName={myGroup?.name} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

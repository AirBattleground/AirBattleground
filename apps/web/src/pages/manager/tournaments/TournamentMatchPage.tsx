import { useEffect, useMemo, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, LayoutGrid, ListChecks } from "lucide-react";
import { MAP_LABELS, type MatchDetail, type MatchScorecard, type StageDetail } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { MapChip } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { screenshotUrl, useMatch, useUnpublishMatch } from "@/features/matches/api";
import { Lightbox, type LightboxImage } from "@/features/matches/components/Lightbox";
import { emptyLineupDraft, LineupStep, lineupDirty, type LineupDraft } from "@/features/matches/components/LineupStep";
import { MatchStatusPill } from "@/features/matches/components/MatchStatusPill";
import { MatchStepper, stepForStatus, type StepKey } from "@/features/matches/components/MatchStepper";
import { emptyResultsDraft, ResultsStep, resultsDirty, type ResultsDraft } from "@/features/matches/components/ResultsStep";
import { ScreenshotUploader } from "@/features/matches/components/ScreenshotUploader";
import { ScorecardList } from "@/features/results/components/Scorecard";
import { MATCH_OPS_TOUR, MatchOps } from "@/features/live/components/MatchOps";
import { useStage } from "@/features/tournaments/manager/api";
import { fmtWhen } from "@/features/tournaments/shared/format";

const TOUR: TourStep[] = [
  { title: "Tournament match", description: "Same three steps as a scrim match: team list → results → publish. Publishing updates the group standings." },
  ...MATCH_OPS_TOUR,
  { element: '[data-tour="match-stepper"]', title: "Where you are", description: "The highlighted step is what to do next. Finished steps get a tick — click them to go back." },
  { element: '[data-tour="uploader"]', title: "Upload screenshots", description: "Drag them in, click to choose, or paste with Ctrl+V. 7xen reads them for you." },
  { element: '[data-tour="lineup-grid"]', title: "Check what was read", description: "One card per slot. Fix any name by typing, then confirm the lineup." },
  { element: '[data-tour="results-table"]', title: "Ranks & finishes", description: "Pick each team's rank and finishes. Points are worked out for you." },
  { element: '[data-tour="results-publish"]', title: "Publish", description: "Publishing shows the scorecard to every team and updates the group standings and promotion." },
];

/** The existing match center, wired to a tournament group (back to the stage, prev/next within the group). */
export default function TournamentMatchPage() {
  usePageTour("manager.tournamentMatch", TOUR);
  const { tournamentId = "", stageId = "", matchId } = useParams();
  const q = useMatch(matchId);
  const stage = useStage(tournamentId, stageId);
  const back = `/manager/tournaments/${tournamentId}/stages/${stageId}?tab=groups`;

  if (q.isError)
    return (
      <>
        <BackLink to={back} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this match" />
      </>
    );
  if (!q.data) return <CenterSkeleton />;
  return <Center key={q.data.match.id} m={q.data} stage={stage.data} back={back} base={`/manager/tournaments/${tournamentId}/stages/${stageId}/matches`} />;
}

function BackLink({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={to}>
        <ArrowLeft /> Back to groups
      </Link>
    </Button>
  );
}

function Center({ m, stage, back, base }: { m: MatchDetail; stage?: StageDetail; back: string; base: string }) {
  const status = m.match.status;
  const [step, setStep] = useState<StepKey>(stepForStatus(status));
  const [lineup, setLineup] = useState<LineupDraft>(emptyLineupDraft);
  const [results, setResults] = useState<ResultsDraft>(emptyResultsDraft);
  const [lightbox, setLightbox] = useState<{ kind: "SLOT_LIST" | "RESULTS"; index: number } | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  const unpublish = useUnpublishMatch(m.match.id);

  const [lastStatus, setLastStatus] = useState(status);
  if (status !== lastStatus) {
    setLastStatus(status);
    setStep(stepForStatus(status));
  }

  const dirty = lineupDirty(lineup) || resultsDirty(results);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const slotShots = useMemo(() => m.screenshots.filter((s) => s.kind === "SLOT_LIST"), [m.screenshots]);
  const resultShots = useMemo(() => m.screenshots.filter((s) => s.kind === "RESULTS"), [m.screenshots]);
  const images = (kind: "SLOT_LIST" | "RESULTS"): LightboxImage[] =>
    (kind === "SLOT_LIST" ? slotShots : resultShots).map((s, i) => ({ id: s.id, src: screenshotUrl(s.id), label: `${kind === "SLOT_LIST" ? "Team list" : "Results"} screenshot ${i + 1}` }));

  // prev/next inside the same group (falls back to nothing until the stage loads)
  const group = stage?.groups.find((g) => g.id === m.tournament?.groupId) ?? stage?.groups.find((g) => g.matches.some((x) => x.id === m.match.id));
  const list = group ? [...group.matches].sort((a, b) => a.number - b.number) : [];
  const idx = list.findIndex((x) => x.id === m.match.id);
  const prev = idx > 0 ? list[idx - 1] : undefined;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : undefined;
  const scheduledAt = list[idx]?.scheduledAt ?? null;
  const published = status === "PUBLISHED";
  const lineupConfirmed = status !== "SCHEDULED" && status !== "LINEUP_REVIEW";
  const groupName = m.tournament?.groupName ?? group?.name;
  const stageName = m.tournament?.stageName ?? stage?.stage.name ?? "Stage";
  const title = m.tournament?.title ?? stage?.tournament.title ?? m.scrim.title;

  const scorecard: MatchScorecard["teams"] = m.teams
    .filter((t) => t.team && t.placement != null)
    .map((t) => ({
      rank: t.placement ?? 0,
      slotNumber: t.slotNumber,
      team: t.team!,
      players: t.players.map((p) => ({ name: p.name, kills: p.kills })),
      kills: t.kills ?? 0,
      placementPoints: t.placementPoints ?? 0,
      killPoints: t.killPoints ?? 0,
      totalPoints: t.totalPoints ?? 0,
    }));

  return (
    <>
      <BackLink to={back} />
      <PageHeader
        eyebrow={`${title} · ${stageName}${groupName ? ` · Group ${groupName}` : ""}${scheduledAt ? ` · ${fmtWhen(scheduledAt)}` : ""}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Match {m.match.number} <MapChip map={m.match.map} className="text-sm" />
          </span>
        }
        actions={
          <>
            <MatchStatusPill status={status} className="text-sm" />
            <div className="flex">
              <Button asChild={!!prev} variant="outline" size="icon" disabled={!prev} aria-label="Previous match" className="rounded-r-none">
                {prev ? (
                  <Link to={`${base}/${prev.id}`} title={`Match ${prev.number} · ${MAP_LABELS[prev.map]}`}>
                    <ChevronLeft />
                  </Link>
                ) : (
                  <ChevronLeft />
                )}
              </Button>
              <Button asChild={!!next} variant="outline" size="icon" disabled={!next} aria-label="Next match" className="-ml-px rounded-l-none">
                {next ? (
                  <Link to={`${base}/${next.id}`} title={`Match ${next.number} · ${MAP_LABELS[next.map]}`}>
                    <ChevronRight />
                  </Link>
                ) : (
                  <ChevronRight />
                )}
              </Button>
            </div>
            <Button asChild variant="outline">
              <Link to={back}>
                <LayoutGrid /> Group standings
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <MatchOps matchId={m.match.id} label={{ title, number: m.match.number, map: m.match.map }} />
        <MatchStepper status={status} active={step} onSelect={setStep} />

        {step === "lineup" && (
          <section className="space-y-4">
            <StepIntro
              n={1}
              title="Who's playing?"
              text={
                published
                  ? "This match is published, so the lineup is locked. Unpublish it to make changes."
                  : lineupConfirmed
                    ? "The lineup is confirmed. You can still fix a name below and save."
                    : "In the game, open the team list (the screen with slot numbers) and take screenshots of every page. Upload them here — or just type the names."
              }
            />
            <ScreenshotUploader
              matchId={m.match.id}
              kind="SLOT_LIST"
              screenshots={slotShots}
              readOnly={published || lineupConfirmed}
              onOpen={(index) => setLightbox({ kind: "SLOT_LIST", index })}
              title="Upload team list screenshots"
              hint="The in-game screen with slot numbers and player names (all pages)."
            />
            <LineupStep
              m={m}
              draft={lineup}
              setDraft={setLineup}
              readOnly={published}
              onOpenShot={(id) => setLightbox({ kind: "SLOT_LIST", index: Math.max(0, slotShots.findIndex((s) => s.id === id)) })}
              onConfirmed={() => setStep("results")}
            />
          </section>
        )}

        {step === "results" && (
          <section className="space-y-4">
            <StepIntro
              n={2}
              title="How did it end?"
              text={
                lineupConfirmed
                  ? "After the match, screenshot the final results (all pages). Upload them, then check ranks and finishes."
                  : "Confirm the lineup in step 1 first — results are matched to the confirmed player names."
              }
            />
            {lineupConfirmed ? (
              <>
                {!published && (
                  <ScreenshotUploader
                    matchId={m.match.id}
                    kind="RESULTS"
                    screenshots={resultShots}
                    onOpen={(index) => setLightbox({ kind: "RESULTS", index })}
                    title="Upload final results screenshots"
                    hint="The end-of-match screen with ranks and “N finishes” (all pages)."
                  />
                )}
                <ResultsStep m={m} draft={results} setDraft={setResults} readOnly={published} />
              </>
            ) : (
              <Button onClick={() => setStep("lineup")}>
                <ListChecks /> Go to step 1
              </Button>
            )}
          </section>
        )}

        {step === "published" && (
          <section className="space-y-4">
            <div className="relative overflow-hidden rounded-2xl border border-success/40 bg-card p-5 shadow-sm sm:p-6">
              <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-success/15 blur-3xl" />
              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-success uppercase">Published</p>
                  <h2 className="font-display text-2xl font-bold">Teams can see these results</h2>
                  <p className="text-sm text-muted-foreground">Group standings are updated. Found a mistake? Unpublish, fix it, and publish again.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setUnpublishing(true)} disabled={unpublish.isPending}>
                    <EyeOff /> Unpublish to edit
                  </Button>
                  {next ? (
                    <Button asChild>
                      <Link to={`${base}/${next.id}`}>
                        Next: Match {next.number} <ChevronRight />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link to={back}>
                        <LayoutGrid /> Back to groups
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <ScorecardList teams={scorecard} />
          </section>
        )}
      </div>

      <Lightbox
        images={lightbox ? images(lightbox.kind) : []}
        index={lightbox?.index ?? null}
        onIndexChange={(i) => setLightbox((l) => (i == null || !l ? null : { ...l, index: i }))}
      />
      <ConfirmDialog
        open={unpublishing}
        onOpenChange={setUnpublishing}
        title="Unpublish these results?"
        description="Teams won't see this match until you publish again, and its points are removed from the group standings for now."
        confirmLabel="Unpublish"
        destructive
        onConfirm={() => unpublish.mutate(undefined, { onSuccess: () => setStep("results") })}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(o) => !o && blocker.state === "blocked" && blocker.reset()}
        title="Leave without saving?"
        description="You have changes that aren't saved yet. They'll be lost if you leave."
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
      />
    </>
  );
}

function StepIntro({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold">
        <span className="text-primary">Step {n} ·</span> {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function CenterSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-36 rounded-xl" />
    </div>
  );
}

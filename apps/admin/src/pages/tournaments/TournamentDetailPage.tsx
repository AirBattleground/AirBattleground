import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  Crown,
  Flag,
  Info,
  ListChecks,
  Lock,
  LockOpen,
  Rocket,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { ManagerTournamentDetail, PromotionCandidate, StageSummary, TournamentEntryRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Pill, TeamAvatar } from "@7xen/ui/components/brand/status";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import {
  useAdminTournament,
  usePromote,
  usePromotionPreview,
  useRemoveEntry,
  useStageDetail,
  useTournamentAction,
  useTournamentEntries,
  type TournamentAction,
} from "@/features/tournaments/api";
import { GroupTable, StageFlow, StageStatusPill, TournamentStatusPill, currentStageIndex, stageShape } from "@/features/tournaments/components";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { element: '[data-tour="t-actions"]', title: "Step in when needed", description: "You can do anything the manager can: open or close registration, cancel, or finish the tournament.", side: "bottom" },
  { element: '[data-tour="t-flow"]', title: "How the tournament flows", description: "Registration, then each stage, then the champion. The highlighted box is where the tournament is right now.", side: "bottom" },
  { element: '[data-tour="t-tabs"]', title: "Teams and stages", description: "Registrations shows confirmed teams and the waitlist. Stages shows groups, standings and promotion.", side: "top" },
];

const when = (iso: string | null) => (iso ? format(parseISO(iso), "EEE, d MMM · h:mm a") : "—");

// ---------------------------------------------------------------- confirm dialog
interface ConfirmSpec {
  title: string;
  body: ReactNode;
  cta: string;
  destructive?: boolean;
  run: () => Promise<unknown>;
}

function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={!!spec} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">{spec?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{spec?.body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel>
          <Button
            variant={spec?.destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              if (!spec) return;
              setBusy(true);
              try {
                await spec.run();
                onClose();
              } catch {
                /* run() toasts */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : spec?.cta}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------- actions bar
const ACTION_TEXT: Record<TournamentAction, { done: string }> = {
  publish: { done: "Tournament published — registration is open" },
  "close-registration": { done: "Registration closed" },
  "reopen-registration": { done: "Registration is open again" },
  cancel: { done: "Tournament cancelled" },
  complete: { done: "Tournament completed" },
};

function Actions({ t, confirm }: { t: ManagerTournamentDetail; confirm: (s: ConfirmSpec) => void }) {
  const action = useTournamentAction(t.id);
  const run = async (a: TournamentAction) => {
    try {
      await action.mutateAsync(a);
      toast.success(ACTION_TEXT[a].done);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };
  const anyDrawn = t.stages.some((s) => s.status !== "PENDING");
  const last = t.stages[t.stages.length - 1];
  const ended = t.status === "COMPLETED" || t.status === "CANCELLED";
  const busy = action.isPending;
  const btns: ReactNode[] = [];
  if (t.status === "DRAFT")
    btns.push(
      <Button key="pub" size="lg" className="shadow-glow" disabled={busy || t.issues.some((i) => i.level === "error")} onClick={() => run("publish").catch(() => {})}>
        <Rocket /> Publish
      </Button>,
    );
  if (t.status === "REGISTRATION_OPEN")
    btns.push(
      <Button key="close" size="lg" variant="outline" disabled={busy} onClick={() => run("close-registration").catch(() => {})}>
        <Lock /> Close registration
      </Button>,
    );
  if (t.status === "REGISTRATION_CLOSED" && !anyDrawn)
    btns.push(
      <Button key="reopen" size="lg" variant="outline" disabled={busy} onClick={() => run("reopen-registration").catch(() => {})}>
        <LockOpen /> Reopen registration
      </Button>,
    );
  if (!ended && last?.status === "COMPLETED")
    btns.push(
      <Button
        key="complete"
        size="lg"
        className="shadow-glow"
        disabled={busy}
        onClick={() =>
          confirm({ title: `Complete ${t.title}?`, body: "The final is finished. This crowns the champion and closes the tournament for good.", cta: "Complete tournament", run: () => run("complete") })
        }
      >
        <Crown /> Complete
      </Button>,
    );
  if (!ended)
    btns.push(
      <Button
        key="cancel"
        size="lg"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        onClick={() =>
          confirm({
            title: `Cancel ${t.title}?`,
            body: (
              <>
                All {t.confirmedCount} registered teams will see it as cancelled and no more matches can be played. <strong>This can't be undone.</strong>
              </>
            ),
            cta: "Cancel tournament",
            destructive: true,
            run: () => run("cancel"),
          })
        }
      >
        <Ban /> Cancel
      </Button>,
    );
  if (!btns.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-tour="t-actions">
      {btns}
    </div>
  );
}

// ---------------------------------------------------------------- overview
function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <span className="mt-0.5 text-primary [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>
        <div className="text-sm font-medium break-words">{children}</div>
      </div>
    </div>
  );
}

function Overview({ t }: { t: ManagerTournamentDetail }) {
  return (
    <div className="space-y-4">
      {t.issues.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          {t.issues.map((i, k) => (
            <li key={k} className={cn("flex gap-2", i.level === "error" ? "text-destructive" : "text-warning-foreground dark:text-warning")}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {i.stage != null && <strong>{t.stages[i.stage]?.name ?? `Stage ${i.stage + 1}`}: </strong>}
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {t.nextAction && t.nextAction.key !== "DONE" && t.status !== "CANCELLED" && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <Info className="size-4 shrink-0 text-primary" />
          <span>
            Manager's next step: <strong>{t.nextAction.label}</strong>
          </span>
        </div>
      )}
      <section className="rounded-xl border bg-card p-4 shadow-sm" data-tour="t-flow">
        <h2 className="mb-3 font-display text-lg font-bold">Format</h2>
        <StageFlow t={t} />
      </section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Fact icon={<Trophy />} label="Prize">{t.prize ?? "—"}</Fact>
        <Fact icon={<CalendarDays />} label="Registration closes">{when(t.registrationClosesAt)}</Fact>
        <Fact icon={<Flag />} label="Starts">{when(t.startsAt)}</Fact>
        <Fact icon={<Users />} label="Team size · first slot">{t.teamSize} players · slot {t.firstSlot}</Fact>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- registrations
function EntryRow({ e, canRemove, onRemove }: { e: TournamentEntryRow; canRemove: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {e.waitlistPosition != null && <span className="w-6 text-right font-display text-sm font-bold text-muted-foreground">{e.waitlistPosition}</span>}
      <TeamAvatar name={e.team.name} tag={e.team.tag} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{e.team.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          [{e.team.tag}] · {relativeTime(e.registeredAt)}
          {e.timePreferences.length > 0 ? ` · ${e.timePreferences.length} time preference${e.timePreferences.length === 1 ? "" : "s"}` : " · any time"}
        </div>
      </div>
      {e.type === "INVITED" && <Pill tone="info">Invited · stage {e.entryStage}</Pill>}
      {canRemove && (
        <Button variant="ghost" size="icon" aria-label={`Remove ${e.team.name}`} className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

function Registrations({ t, confirm }: { t: ManagerTournamentDetail; confirm: (s: ConfirmSpec) => void }) {
  const entries = useTournamentEntries(t.id);
  const remove = useRemoveEntry(t.id);
  if (entries.isPending) return <ListSkeleton rows={4} />;
  if (entries.isError) return <EmptyState icon={<AlertTriangle />} title="Couldn't load registrations" description={errorMessage(entries.error)} />;
  const items = entries.data.items;
  const confirmed = items.filter((e) => e.status === "CONFIRMED");
  const waitlist = items.filter((e) => e.status === "WAITLISTED");
  const canRemove = t.status !== "COMPLETED" && t.status !== "CANCELLED";
  const beforeDraw = t.stages[0]?.status === "PENDING";
  const ask = (e: TournamentEntryRow) =>
    confirm({
      title: `Remove ${e.team.name}?`,
      body: beforeDraw && e.status === "CONFIRMED" && waitlist.length ? `${waitlist[0]!.team.name} is first on the waitlist and will get the spot.` : "The team loses its place in this tournament.",
      cta: "Remove team",
      destructive: true,
      run: async () => {
        try {
          await remove.mutateAsync(e.id);
          toast.success(`${e.team.name} removed`);
        } catch (err) {
          toast.error(errorMessage(err));
          throw err;
        }
      },
    });
  if (!confirmed.length && !waitlist.length)
    return <EmptyState icon={<ListChecks />} title="No teams yet" description={t.status === "DRAFT" ? "Teams can register once the tournament is published." : "Registered teams will appear here."} />;
  const block = (title: string, list: TournamentEntryRow[], extra: ReactNode) => (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-display text-lg font-bold">{title}</h3>
        {extra}
      </header>
      {list.length ? (
        <ul className="max-h-[28rem] divide-y overflow-y-auto">
          {list.map((e) => (
            <EntryRow key={e.id} e={e} canRemove={canRemove} onRemove={() => ask(e)} />
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Nobody here.</p>
      )}
    </section>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {block(
        "Confirmed",
        confirmed,
        <span className="text-sm text-muted-foreground">
          {/* invited teams skip registration and don't count toward maxTeams */}
          <strong className="font-display text-foreground">{confirmed.filter((e) => e.type === "REGISTERED").length}</strong> / {t.maxTeams}
          {confirmed.some((e) => e.type === "INVITED") && <> · +{confirmed.filter((e) => e.type === "INVITED").length} invited</>}
        </span>,
      )}
      {block("Waitlist", waitlist, <span className="text-sm text-muted-foreground">{waitlist.length} waiting</span>)}
    </div>
  );
}

// ---------------------------------------------------------------- promotion
function CandidateList({ title, rows, tone }: { title: string; rows: PromotionCandidate[]; tone: "success" | "danger" }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </h4>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {rows.map((c) => (
          <li key={c.team.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="w-10 shrink-0 font-display font-bold text-muted-foreground">{c.groupName}{c.groupRank}</span>
            <span className="min-w-0 flex-1 truncate">{c.team.name}</span>
            {c.via === "WILDCARD" && <Pill tone="info">Wildcard</Pill>}
            <span className={cn("font-display font-bold", tone === "success" ? "text-success" : "text-muted-foreground")}>{c.totalPoints}</span>
          </li>
        ))}
        {!rows.length && <li className="px-3 py-2 text-sm text-muted-foreground">None</li>}
      </ul>
    </div>
  );
}

function PromotionDialog({ tournamentId, stage, open, onClose }: { tournamentId: string; stage: StageSummary; open: boolean; onClose: () => void }) {
  const preview = usePromotionPreview(tournamentId, stage.id, open);
  const promote = usePromote(tournamentId);
  const p = preview.data;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !promote.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Promote from {stage.name}</DialogTitle>
          <DialogDescription>
            {p?.nextStage ? `Qualified teams move to ${p.nextStage.name} (${p.nextStage.teamsIn} teams).` : "This is the last stage — promoting finishes it so the tournament can be completed."}
          </DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
        ) : p ? (
          <div className="space-y-4">
            {p.blockers.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {p.blockers.map((b) => (
                  <li key={b} className="flex gap-2"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{b}</li>
                ))}
              </ul>
            )}
            {p.tiesAtCutoff.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground dark:text-warning">
                {p.tiesAtCutoff.map((b) => (
                  <li key={b} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{b}</li>
                ))}
              </ul>
            )}
            {p.nextStage && p.nextStage.invited.length > 0 && (
              <p className="text-sm text-muted-foreground">Invited straight into {p.nextStage.name}: {p.nextStage.invited.map((x) => x.name).join(", ")}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <CandidateList title="Qualified" rows={p.qualified} tone="success" />
              <CandidateList title="Eliminated" rows={p.eliminated} tone="danger" />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={promote.isPending}>Not yet</Button>
          <Button
            className="shadow-glow"
            disabled={!p?.ready || promote.isPending}
            onClick={async () => {
              try {
                await promote.mutateAsync({ stageId: stage.id, input: { include: [], exclude: [] } });
                toast.success(p?.nextStage ? `${p.qualified.length} teams promoted to ${p.nextStage.name}` : `${stage.name} finished`);
                onClose();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <TrendingUp /> {promote.isPending ? "Promoting…" : p?.nextStage ? `Promote ${p.qualified.length} teams` : "Finish stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- stages
function Stages({ t }: { t: ManagerTournamentDetail }) {
  const [params, setParams] = useSearchParams();
  const cur = Math.min(Math.max(currentStageIndex(t), 0), t.stages.length - 1);
  const stageId = params.get("stage") && t.stages.some((s) => s.id === params.get("stage")) ? params.get("stage")! : t.stages[cur]?.id;
  const stage = t.stages.find((s) => s.id === stageId);
  const detail = useStageDetail(t.id, stage && stage.status !== "PENDING" ? stage.id : null);
  const [promoting, setPromoting] = useState(false);
  if (!stage) return null;
  const pick = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("stage", id);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {t.stages.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(s.id)}
            className={cn(
              "rounded-xl border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              s.id === stage.id ? "border-primary/60 bg-primary/10" : "bg-card hover:border-primary/40",
            )}
          >
            <span className="block font-display font-bold">{s.order}. {s.name}</span>
            <span className="block text-xs text-muted-foreground">{stageShape(s)}</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-bold">{stage.name}</h3>
            <StageStatusPill status={stage.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {stage.teamsIn} teams · {stageShape(stage)}
            {stage.startsAt && <> · {when(stage.startsAt)}</>}
            {stage.drawSeed && <> · draw seed <span className="font-mono">{stage.drawSeed}</span></>}
          </p>
        </div>
        {stage.status === "LIVE" && (
          <Button size="lg" className="shadow-glow" onClick={() => setPromoting(true)}>
            <TrendingUp /> Promotion preview
          </Button>
        )}
      </section>

      {stage.status === "PENDING" ? (
        <EmptyState icon={<Users />} title="Groups not drawn yet" description={stage.order === 1 ? "The manager draws groups after registration closes." : "Groups are drawn after the previous stage promotes its teams."} />
      ) : detail.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : detail.isError ? (
        <EmptyState icon={<AlertTriangle />} title="Couldn't load this stage" description={errorMessage(detail.error)} action={<Button variant="outline" onClick={() => detail.refetch()}>Try again</Button>} />
      ) : (
        <>
          {stage.order === 1 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {detail.data.unmetPreferences.length ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
              {detail.data.unmetPreferences.length
                ? `${detail.data.unmetPreferences.length} ${detail.data.unmetPreferences.length === 1 ? "team" : "teams"} didn't get a preferred time slot.`
                : "Every team got one of its preferred time slots."}
            </p>
          )}
          <div className={cn("grid gap-4", detail.data.groups.length > 1 && "2xl:grid-cols-2")}>
            {detail.data.groups.map((g) => (
              <GroupTable key={g.id} group={g} isFinal={stage.order === t.stages.length} />
            ))}
          </div>
        </>
      )}
      {stage.status === "LIVE" && <PromotionDialog tournamentId={t.id} stage={stage} open={promoting} onClose={() => setPromoting(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- page
type Tab = "registrations" | "stages";

export default function TournamentDetailPage() {
  usePageTour("admin.tournamentDetail", TOUR);
  const { id } = useParams<{ id: string }>();
  const q = useAdminTournament(id);
  const [params, setParams] = useSearchParams();
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const t = q.data;
  const defaultTab: Tab = t && currentStageIndex(t) >= 0 ? "stages" : "registrations";
  const tab = (params.get("tab") as Tab | null) ?? defaultTab;

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link to="/tournaments"><ArrowLeft /> All tournaments</Link>
    </Button>
  );

  if (q.isPending)
    return (
      <>
        {back}
        <Skeleton className="mb-2 h-9 w-2/3" />
        <Skeleton className="mb-6 h-5 w-1/3" />
        <Skeleton className="h-40 rounded-xl" />
      </>
    );
  if (q.isError || !t)
    return (
      <>
        {back}
        <EmptyState icon={<AlertTriangle />} title="Couldn't load this tournament" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => q.refetch()}>Try again</Button>} />
      </>
    );

  return (
    <>
      {back}
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Tournament <TournamentStatusPill status={t.status} /></span>}
        title={t.title}
        description={<>Run by <strong className="text-foreground">{t.manager.displayName}</strong> · created {relativeTime(t.createdAt)}</>}
        actions={<Actions t={t} confirm={setConfirmSpec} />}
      />
      <div className="space-y-6">
        {t.champion && (
          <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-gradient-to-r from-primary/15 to-transparent p-4">
            <Crown className="size-6 text-primary" />
            <span className="font-display text-xl font-bold">Champion: {t.champion.name}</span>
          </div>
        )}
        <Overview t={t} />
        <div data-tour="t-tabs">
          <Tabs value={tab} onValueChange={(v) => setParams(v === defaultTab ? {} : { tab: v }, { replace: true })} className="mb-4">
            <TabsList>
              <TabsTrigger value="registrations" className="gap-2 px-4">
                Registrations <span className="rounded-md bg-muted px-1.5 text-[11px] font-bold">{t.confirmedCount}</span>
              </TabsTrigger>
              <TabsTrigger value="stages" className="gap-2 px-4">
                Stages <span className="rounded-md bg-muted px-1.5 text-[11px] font-bold">{t.stages.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "registrations" ? <Registrations t={t} confirm={setConfirmSpec} /> : <Stages t={t} />}
        </div>
      </div>
      <ConfirmDialog spec={confirmSpec} onClose={() => setConfirmSpec(null)} />
    </>
  );
}

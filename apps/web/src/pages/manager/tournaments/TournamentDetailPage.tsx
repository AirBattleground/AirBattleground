import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Copy, Crown, LockOpen, MoreHorizontal, Pencil, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ManagerTournamentDetail, StageSummary } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate, formatTime } from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { useTournament, useTournamentAction } from "@/features/tournaments/manager/api";
import { FormatIssues } from "@/features/tournaments/manager/components/FormatIssues";
import { NextAction } from "@/features/tournaments/manager/components/NextAction";
import { pointsLabel } from "@/features/tournaments/manager/components/PointsPicker";
import { Fact, Zone } from "@/features/tournaments/manager/components/Zone";
import { RegistrationsTab } from "@/features/tournaments/manager/components/RegistrationsTab";
import { fmtDay, fmtRange, fmtWhen, fmtPrize } from "@/features/tournaments/shared/format";
import { RegistrationMeter } from "@/features/tournaments/shared/RegistrationMeter";
import { StageFlow, StageFlowSkeleton } from "@/features/tournaments/shared/StageFlow";
import { StatusPill } from "@/features/tournaments/shared/StatusPill";

const TOUR: TourStep[] = [
  { title: "Tournament control center", description: "Everything about this tournament in one place — and one button that always tells you what to do next." },
  { element: '[data-tour="t-next-action"]', title: "Your next step", description: "Publish, close registration, draw groups, start, promote… Just follow this button." },
  { element: '[data-tour="t-hero"]', title: "At a glance", description: "Status, prize and how many teams have registered. “Copy summary” gives you a message to paste into WhatsApp or Discord." },
  { element: '[data-tour="t-flow"]', title: "Stage map", description: "How teams move through the stages. The current stage pulses — tap a stage to open it." },
  { element: '[data-tour="t-tabs"]', title: "More details", description: "Overview, the list of registered teams (with the waitlist), and every stage." },
];

type Tab = "overview" | "registrations" | "stages";

export default function TournamentDetailPage() {
  usePageTour("manager.tournamentDetail", TOUR);
  const { tournamentId } = useParams();
  const q = useTournament(tournamentId);
  if (q.isError)
    return (
      <>
        <BackLink />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this tournament" />
      </>
    );
  if (!q.data) return <DetailSkeleton />;
  return <ControlCenter t={q.data} />;
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/manager/tournaments">
        <ArrowLeft /> All tournaments
      </Link>
    </Button>
  );
}

function shareText(t: ManagerTournamentDetail): string {
  const lines = [`🏆 ${t.title}`];
  if (t.prize) lines.push(`💰 Prize: ${fmtPrize(t.prize)}`);
  lines.push(`👥 ${t.confirmedCount}/${t.maxTeams} teams registered${t.waitlistCount ? ` (+${t.waitlistCount} waitlist)` : ""}`);
  lines.push(`🗺️ Format: ${t.stages.map((s) => `${s.name}${s.groupCount > 1 ? ` (${s.groupCount}×${s.lobbySize})` : ""}`).join(" → ")}`);
  if (t.startsAt) lines.push(`📅 Starts ${fmtWhen(t.startsAt)} IST`);
  if (t.status === "REGISTRATION_OPEN") lines.push(t.registrationClosesAt ? `⏳ Registration closes ${fmtWhen(t.registrationClosesAt)}` : "✅ Registration is open — first come, first served");
  if (t.champion) lines.push(`👑 Champion: ${t.champion.name}`);
  return lines.join("\n");
}

function ControlCenter({ t }: { t: ManagerTournamentDetail }) {
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "registrations", "stages"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === "overview") next.delete("tab");
    else next.set("tab", v);
    setParams(next, { replace: true });
  };
  const action = useTournamentAction(t.id);
  const [cancelling, setCancelling] = useState(false);
  const canReopen = t.status === "REGISTRATION_CLOSED" && t.stages[0]?.status === "PENDING";
  const closedForGood = t.status === "COMPLETED" || t.status === "CANCELLED";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText(t));
      toast.success("Summary copied", { description: "Paste it into WhatsApp, Discord or anywhere." });
    } catch {
      toast.error("Couldn't copy — your browser blocked it");
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader
        title={t.title}
        description={t.description ? <span className="line-clamp-1">{t.description}</span> : undefined}
        actions={
          <>
            <StatusPill status={t.status} className="text-sm" />
            <Button variant="outline" onClick={() => void copy()} aria-label="Copy summary" title="Copy a summary to paste into WhatsApp or Discord">
              <Copy /> <span className="hidden sm:inline">Copy summary</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!closedForGood && (
                  <DropdownMenuItem asChild>
                    <Link to={`/manager/tournaments/${t.id}/edit`}>
                      <Pencil /> Edit details
                    </Link>
                  </DropdownMenuItem>
                )}
                {canReopen && (
                  <DropdownMenuItem onSelect={() => action.mutate("reopen-registration")}>
                    <LockOpen /> Reopen registration
                  </DropdownMenuItem>
                )}
                {!closedForGood && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setCancelling(true)}>
                      <XCircle /> Cancel tournament
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* phones: one column (next step → glance → rest); desktop: main column + key-facts rail */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="contents lg:block lg:min-w-0 lg:space-y-6">
        <NextAction t={t} />

        {t.issues.length > 0 && t.status === "DRAFT" && (
          <FormatIssues issues={t.issues} stageNames={t.stages.map((s) => s.name)} okText={null} className="order-3 lg:order-none" />
        )}

        <Zone label="Stage map" data-tour="t-flow" className="order-3 min-w-0 lg:order-none">
          <StageFlow
            stages={t.stages}
            registration={{ open: t.status === "REGISTRATION_OPEN" || t.status === "DRAFT", confirmed: t.confirmedCount, max: t.maxTeams }}
            champion={t.champion}
            stageHref={(s) => `/manager/tournaments/${t.id}/stages/${s.id}`}
          />
        </Zone>

        <Tabs value={tab} onValueChange={setTab} className="order-3 min-w-0 lg:order-none">
          <TabsList data-tour="t-tabs" className="grid h-10 w-full grid-cols-3 sm:inline-flex sm:w-auto">
            <TabsTrigger value="overview" className="px-3 sm:px-4">
Overview
            </TabsTrigger>
            <TabsTrigger value="registrations" className="px-3 sm:px-4">
Teams
              <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[11px] font-bold">{t.confirmedCount}</span>
            </TabsTrigger>
            <TabsTrigger value="stages" className="px-3 sm:px-4">
Stages
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <Overview t={t} />
          </TabsContent>
          <TabsContent value="registrations" className="mt-4">
            <RegistrationsTab t={t} />
          </TabsContent>
          <TabsContent value="stages" className="mt-4">
            <StagesList t={t} />
          </TabsContent>
        </Tabs>
        </div>
        <Glance t={t} />
      </div>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel “${t.title}”?`}
        description="Teams will see it as cancelled and no more matches can be played. This can't be undone."
        confirmLabel="Cancel tournament"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => action.mutate("cancel")}
      />
    </>
  );
}

function Overview({ t }: { t: ManagerTournamentDetail }) {
  const first = t.stages[0];
  return (
    <div className="space-y-6">
      {t.slotOptions.length > 0 && (
        <Zone label={`${first?.name ?? "Qualifier"} time slots`} title="Teams rank these when they register. The draw gives each team its best slot with room, in sign-up order.">
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {t.slotOptions.map((o) => {
              const pct = o.capacity ? Math.min(100, (o.taken / o.capacity) * 100) : 0;
              return (
                <li key={o.id} className="rounded-xl bg-muted/50 p-3" title={`First choice of ${o.taken} team${o.taken === 1 ? "" : "s"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{o.label}</span>
                    <span className="shrink-0 font-display text-sm font-bold">
                      {o.taken}/{o.capacity}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Zone>
      )}
      <Zone label="Rules">
        {t.rules ? <p className="text-sm whitespace-pre-line">{t.rules}</p> : <p className="text-sm text-muted-foreground">No rules yet — add them in “Edit details”.</p>}
      </Zone>
    </div>
  );
}

/** Key facts zone: prize (or champion) big, registration meter, the rest as small key/value rows. */
function Glance({ t }: { t: ManagerTournamentDetail }) {
  return (
    <Zone label="At a glance" data-tour="t-hero" className="order-2 lg:sticky lg:top-20 lg:order-none" bodyClassName="space-y-4">
      {t.champion ? (
        <p className="flex items-center gap-2 font-display text-xl font-bold">
          <Crown className="size-5 shrink-0 text-warning-foreground dark:text-warning" /> <span className="truncate">{t.champion.name}</span>
          <span className="text-sm font-semibold text-muted-foreground">champions</span>
        </p>
      ) : t.prize ? (
        <p className="flex items-center gap-2 font-display text-2xl font-bold text-warning-foreground dark:text-warning">
          <Trophy className="size-5 shrink-0" /> <span className="truncate">{fmtPrize(t.prize)}</span>
        </p>
      ) : null}
      <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} hideHint={t.status !== "REGISTRATION_OPEN"} />
      <dl className="divide-y border-t pt-3">
        <Fact label="Dates">{fmtRange(t.startsAt, t.stages[t.stages.length - 1]?.endsAt ?? null)}</Fact>
        {(t.status === "DRAFT" || t.status === "REGISTRATION_OPEN") && (
          <Fact label="Registration closes">{t.registrationClosesAt ? fmtDay(t.registrationClosesAt) : "At start"}</Fact>
        )}
        <Fact label="Team size">{t.teamSize} players</Fact>
        <Fact label="Points">{pointsLabel(t.pointsSystem)}</Fact>
        <Fact label="First slot">#{t.firstSlot}</Fact>
      </dl>
    </Zone>
  );
}

function StagesList({ t }: { t: ManagerTournamentDetail }) {
  return (
    <ol className="space-y-3" data-tour="t-stages">
      {t.stages.map((s) => (
        <li key={s.id}>
          <StageRow t={t} s={s} />
        </li>
      ))}
    </ol>
  );
}

function StageRow({ t, s }: { t: ManagerTournamentDetail; s: StageSummary }) {
  const last = s.order === t.stages.length;
  const cfg = s.schedule;
  return (
    <Link
      to={`/manager/tournaments/${t.id}/stages/${s.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm outline-none transition-all hover:border-primary/40 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-4 sm:p-5",
        s.status === "LIVE" && "border-destructive/30",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-lg font-bold text-primary">{s.order}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg leading-tight font-bold group-hover:text-primary">{s.name}</span>
          <StatusPill kind="stage" status={s.status} />
        </p>
        <p className="text-sm">
          <span className="font-semibold">{s.teamsIn} teams</span>
          <span className="text-muted-foreground">
            {" "}· {s.groupCount > 1 ? `${s.groupCount} × ${s.lobbySize}` : "1 lobby"} · {s.matchesPerGroup} matches ·{" "}
            {last ? "decides the champion" : `${s.teamsOut} go through`}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {cfg
            ? `${formatDate(cfg.startDate)} → ${formatDate(cfg.endDate)} · ${cfg.windows.map((w) => `${formatTime(w.start)}–${formatTime(w.end)}`).join(", ")}`
            : "Not scheduled yet"}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-12 w-80" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <div className="rounded-2xl border p-5">
        <StageFlowSkeleton />
      </div>
    </div>
  );
}

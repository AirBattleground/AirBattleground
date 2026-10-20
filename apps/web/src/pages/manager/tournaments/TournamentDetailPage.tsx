import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Copy,
  Crown,
  Hourglass,
  Layers,
  LayoutDashboard,
  ListChecks,
  LockOpen,
  MoreHorizontal,
  Pencil,
  ScrollText,
  Ticket,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ManagerTournamentDetail, StageSummary } from "@7xen/shared";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate, formatTime } from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { MapChips } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { useTournament, useTournamentAction } from "@/features/tournaments/manager/api";
import { FormatIssues } from "@/features/tournaments/manager/components/FormatIssues";
import { NextAction } from "@/features/tournaments/manager/components/NextAction";
import { pointsLabel } from "@/features/tournaments/manager/components/PointsPicker";
import { RegistrationsTab } from "@/features/tournaments/manager/components/RegistrationsTab";
import { fmtDay, fmtRange, fmtWhen, fmtPrize } from "@/features/tournaments/shared/format";
import { RegistrationMeter } from "@/features/tournaments/shared/RegistrationMeter";
import { StageFlow, StageFlowSkeleton } from "@/features/tournaments/shared/StageFlow";
import { StatusPill } from "@/features/tournaments/shared/StatusPill";

const TOUR: TourStep[] = [
  { title: "Tournament control center", description: "Everything about this tournament in one place — and one button that always tells you what to do next." },
  { element: '[data-tour="t-hero"]', title: "At a glance", description: "Status, prize and how many teams have registered. “Copy summary” gives you a message to paste into WhatsApp or Discord." },
  { element: '[data-tour="t-next-action"]', title: "Your next step", description: "Publish, close registration, draw groups, start, promote… Just follow this button." },
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
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Trophy className="size-3.5" /> Tournament
          </span>
        }
        title={t.title}
        description={t.description ?? undefined}
        actions={
          <>
            <StatusPill status={t.status} className="text-sm" />
            <Button variant="outline" onClick={() => void copy()}>
              <Copy /> Copy summary
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
                {closedForGood && (
                  <DropdownMenuItem onSelect={() => void copy()}>
                    <Copy /> Copy summary
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="space-y-6">
        {/* hero */}
        <section data-tour="t-hero" className="bg-grid relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-card to-card p-5 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute -top-20 -right-20 size-64 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:items-center">
            <div className="min-w-0 space-y-2">
              {t.champion ? (
                <p className="flex items-center gap-2 font-display text-2xl font-bold">
                  <Crown className="size-6 text-warning-foreground dark:text-warning" /> {t.champion.name} are the champions
                </p>
              ) : t.prize ? (
                <p className="flex items-center gap-2 font-display text-3xl font-bold text-warning-foreground sm:text-4xl dark:text-warning">
                  <Trophy className="size-7 shrink-0" /> {fmtPrize(t.prize)}
                </p>
              ) : (
                <p className="font-display text-2xl font-bold">{t.stages.map((s) => s.name).join(" → ")}</p>
              )}
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="size-4 text-primary" /> {fmtRange(t.startsAt, t.stages[t.stages.length - 1]?.endsAt ?? null)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="size-4 text-primary" /> {t.teamSize} players per team
                </span>
                <span className="flex items-center gap-1.5">
                  <Layers className="size-4 text-primary" /> {t.stages.length} {t.stages.length === 1 ? "stage" : "stages"}
                </span>
              </p>
            </div>
            <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} hideHint={t.status !== "REGISTRATION_OPEN"} />
          </div>
        </section>

        <NextAction t={t} />

        {t.issues.length > 0 && t.status === "DRAFT" && <FormatIssues issues={t.issues} stageNames={t.stages.map((s) => s.name)} okText={null} />}

        <section data-tour="t-flow" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="mb-1 font-display text-lg font-bold">Stage map</h2>
          <StageFlow
            stages={t.stages}
            registration={{ open: t.status === "REGISTRATION_OPEN" || t.status === "DRAFT", confirmed: t.confirmedCount, max: t.maxTeams }}
            champion={t.champion}
            stageHref={(s) => `/manager/tournaments/${t.id}/stages/${s.id}`}
          />
        </section>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList data-tour="t-tabs" className="h-10">
            <TabsTrigger value="overview" className="px-3 sm:px-4">
              <LayoutDashboard /> Overview
            </TabsTrigger>
            <TabsTrigger value="registrations" className="px-3 sm:px-4">
              <ListChecks /> Teams
              <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[11px] font-bold">{t.confirmedCount}</span>
            </TabsTrigger>
            <TabsTrigger value="stages" className="px-3 sm:px-4">
              <Layers /> Stages
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Registered" value={`${t.confirmedCount}/${t.maxTeams}`} icon={<Users />} />
        <StatCard label="Waitlist" value={t.waitlistCount} icon={<Hourglass />} tone="warning" />
        <StatCard label="Starts" value={<span className="text-2xl">{t.startsAt ? fmtDay(t.startsAt) : "—"}</span>} icon={<CalendarClock />} tone="info" />
        <StatCard label="Registration closes" value={<span className="text-2xl">{t.registrationClosesAt ? fmtDay(t.registrationClosesAt) : "At start"}</span>} icon={<Ticket />} tone="success" />
      </div>

      {t.slotOptions.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <h3 className="font-display text-lg font-bold">{first?.name ?? "Qualifier"} time slots</h3>
          <p className="mb-3 text-sm text-muted-foreground">Teams rank these when they register. The draw gives them their best slot with room, in sign-up order.</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {t.slotOptions.map((o) => {
              const pct = o.capacity ? Math.min(100, (o.taken / o.capacity) * 100) : 0;
              return (
                <li key={o.id} className="rounded-xl border bg-background p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{o.label}</span>
                    <span className="shrink-0 font-display text-sm font-bold">
                      {o.taken}/{o.capacity}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">first choice of {o.taken} team{o.taken === 1 ? "" : "s"}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard icon={<Trophy />} title="Scoring & slots">
          <p>
            <span className="font-semibold">Points:</span> {pointsLabel(t.pointsSystem)}
          </p>
          <p>
            <span className="font-semibold">Slots:</span> teams start at #{t.firstSlot} in every lobby
          </p>
        </InfoCard>
        <InfoCard icon={<ScrollText />} title="Rules">
          {t.rules ? <p className="whitespace-pre-line">{t.rules}</p> : <p className="text-muted-foreground">No rules added. You can add them from “Edit details”.</p>}
        </InfoCard>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-bold [&_svg]:size-4.5 [&_svg]:text-primary">
        {icon} {title}
      </h3>
      <div className="space-y-1 text-sm">{children}</div>
    </section>
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
        "group flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm outline-none transition-all hover:border-primary/40 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:p-5",
        s.status === "LIVE" && "border-destructive/30",
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-xl font-bold text-primary">{s.order}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-display text-xl leading-tight font-bold group-hover:text-primary">{s.name}</span>
          <StatusPill kind="stage" status={s.status} />
        </p>
        <p className="text-sm text-muted-foreground">
          {s.teamsIn} teams · {s.groupCount > 1 ? `${s.groupCount} groups × ${s.lobbySize}` : "1 lobby"} · {s.matchesPerGroup} matches ·{" "}
          {last ? "decides the champion" : `top ${s.advancePerGroup}${s.groupCount > 1 ? "/group" : ""}${s.wildcardCount ? ` + ${s.wildcardCount} wildcards` : ""} → ${s.teamsOut}`}
          {s.invitedSlots > 0 && ` · ${s.invitedSlots} invited`}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          {cfg
            ? `${formatDate(cfg.startDate)} → ${formatDate(cfg.endDate)} · ${cfg.windows.map((w) => `${formatTime(w.start)}–${formatTime(w.end)}`).join(", ")}${s.plan ? ` · ${s.plan.days} ${s.plan.days === 1 ? "evening" : "evenings"}` : ""}`
            : "Not scheduled yet"}
        </p>
        <MapChips maps={s.maps} numbered />
      </div>
      <ChevronRight className="hidden size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
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

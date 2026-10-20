import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Crosshair, Crown, Hourglass, Layers, Plus, Trophy } from "lucide-react";
import type { TournamentMode, TournamentStatus, TournamentSummary } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { QueryError } from "@/features/manager/components/QueryError";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { useTournaments } from "@/features/tournaments/manager/api";
import { fmtDay } from "@/features/tournaments/shared/format";
import { RegistrationMeter } from "@/features/tournaments/shared/RegistrationMeter";
import { StatusPill } from "@/features/tournaments/shared/StatusPill";

const TOUR: TourStep[] = [
  { title: "Your tournaments", description: "Multi-stage cups: qualifiers, semis and a final — all run from here." },
  { element: '[data-tour="t-create"]', title: "Create a tournament", description: "A short wizard sets up the format, schedule and registration for you." },
  { element: '[data-tour="t-filter"]', title: "Filter", description: "Switch between running, drafts and finished tournaments." },
  { element: '[data-tour="t-card"]', title: "Open one", description: "Each card shows its status, how many teams registered and the current stage. Tap it to run the tournament." },
];

type Filter = "active" | "draft" | "done" | "all";
const FILTERS: { key: Filter; label: string; match: (s: TournamentStatus) => boolean }[] = [
  { key: "active", label: "Running", match: (s) => s === "REGISTRATION_OPEN" || s === "REGISTRATION_CLOSED" || s === "LIVE" },
  { key: "draft", label: "Drafts", match: (s) => s === "DRAFT" },
  { key: "done", label: "Finished", match: (s) => s === "COMPLETED" || s === "CANCELLED" },
  { key: "all", label: "All", match: () => true },
];
const ORDER: Record<TournamentStatus, number> = { LIVE: 0, REGISTRATION_CLOSED: 1, REGISTRATION_OPEN: 2, DRAFT: 3, COMPLETED: 4, CANCELLED: 5 };

const TDM_TOUR: TourStep[] = [
  { title: "TDM battles", description: "Knockouts of 2-team Team Deathmatch matches: winners go through until one champion is left." },
  { element: '[data-tour="t-create"]', title: "Create a TDM battle", description: "Pick the number of teams, the maps and the time. The bracket builds itself." },
  { element: '[data-tour="t-filter"]', title: "Filter", description: "Switch between running, drafts and finished battles." },
  { element: '[data-tour="t-card"]', title: "Open one", description: "Run the bracket round by round: draw, play, publish results, send the winners through." },
];

const COPY: Record<TournamentMode, { title: string; description: string; create: string; newHref: string; emptyTitle: string; emptyText: string; errorTitle: string }> = {
  BR: {
    title: "Tournaments",
    description: "Qualifiers, semi-finals and a grand final — set up once, then follow one button at a time.",
    create: "Create tournament",
    newHref: "/manager/tournaments/new",
    emptyTitle: "Run your first tournament",
    emptyText: "Pick a size (16, 64, 128 teams…), choose the dates and publish. Teams register first-come-first-served and AirBattleground handles groups, schedule and who goes through.",
    errorTitle: "We couldn't load your tournaments",
  },
  TDM: {
    title: "TDM battles",
    description: "2 teams per match, winner goes through. 4 teams = two semi-finals and a final.",
    create: "Create TDM battle",
    newHref: "/manager/tdm/new",
    emptyTitle: "Run your first TDM battle",
    emptyText: "Pick 4, 8, 16, 32 or 64 teams, the TDM maps and a start time. Teams register, you run each round, and the champion earns BG coins.",
    errorTitle: "We couldn't load your TDM battles",
  },
};

export default function TournamentsPage() {
  return <TournamentsList mode="BR" />;
}

/** The manager's tournaments of one mode (BR tournaments or TDM battles). */
export function TournamentsList({ mode }: { mode: TournamentMode }) {
  usePageTour(mode === "TDM" ? "manager.tdm" : "manager.tournaments", mode === "TDM" ? TDM_TOUR : TOUR);
  const copy = COPY[mode];
  const q = useTournaments();
  const [filter, setFilter] = useState<Filter | null>(null);
  const data = useMemo(() => q.data?.filter((t) => (t.mode ?? "BR") === mode), [q.data, mode]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, data?.filter((t) => f.match(t.status)).length ?? 0])) as Record<Filter, number>, [data]);
  // default to the first non-empty filter so a manager with only drafts doesn't land on an empty list
  const active = filter ?? (counts.active ? "active" : counts.draft ? "draft" : "all");
  const items = useMemo(
    () =>
      [...(data ?? [])]
        .filter((t) => FILTERS.find((f) => f.key === active)!.match(t.status))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.startsAt ?? a.createdAt).localeCompare(b.startsAt ?? b.createdAt)),
    [data, active],
  );

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button asChild size="lg" data-tour="t-create" className="shadow-glow">
            <Link to={copy.newHref}>
              <Plus /> {copy.create}
            </Link>
          </Button>
        }
      />

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={copy.errorTitle} />
      ) : !data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={mode === "TDM" ? <Crosshair /> : <Trophy />}
          title={copy.emptyTitle}
          description={copy.emptyText}
          action={
            <Button asChild size="lg">
              <Link to={copy.newHref}>
                <Plus /> {copy.create}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <ToggleGroup
            data-tour="t-filter"
            type="single"
            variant="outline"
            value={active}
            onValueChange={(v) => v && setFilter(v as Filter)}
            className="flex-wrap justify-start"
          >
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f.key} value={f.key} className="h-9 px-3.5">
                {f.label}
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[11px] font-bold text-muted-foreground">{counts[f.key]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {items.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title={active === "draft" ? "No drafts" : active === "done" ? "Nothing finished yet" : "Nothing running right now"}
              description={active === "draft" ? "Drafts you save in the wizard show up here." : `Publish a ${mode === "TDM" ? "TDM battle" : "tournament"} to open registration.`}
            />
          ) : (
            <StaggerList key={active} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((t, i) => (
                <StaggerItem key={t.id}>
                  <TournamentCard t={t} tour={i === 0 ? "t-card" : undefined} />
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      )}
    </>
  );
}

function TournamentCard({ t, tour }: { t: TournamentSummary; tour?: string }) {
  const live = t.status === "LIVE";
  return (
    <Link
      to={`/manager/tournaments/${t.id}`}
      data-tour={tour}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50",
        live && "border-destructive/30",
        (t.status === "CANCELLED" || t.status === "DRAFT") && "bg-card/70",
      )}
    >
      <div className="bg-grid relative border-b bg-gradient-to-br from-primary/12 to-transparent p-4">
        <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-primary/15 blur-2xl transition-opacity group-hover:opacity-100" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-xl leading-tight font-bold group-hover:text-primary">{t.title}</p>
            {t.prize ? (
              <p className="mt-1 flex items-center gap-1.5 truncate font-display text-base font-bold text-warning-foreground dark:text-warning">
                <Trophy className="size-4 shrink-0" /> {t.prize}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t.stagesCount} {t.stagesCount === 1 ? "stage" : "stages"}</p>
            )}
          </div>
          <StatusPill status={t.status} className="shrink-0" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {t.champion ? (
          <p className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <Crown className="size-4 text-warning-foreground dark:text-warning" /> Champion: <span className="font-semibold">{t.champion.name}</span>
          </p>
        ) : (
          <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} size="sm" hideHint={t.status !== "REGISTRATION_OPEN"} />
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {t.currentStage && (
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Layers className="size-3.5 text-primary" /> Stage {t.currentStage.order}: {t.currentStage.name}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5" /> {t.startsAt ? `Starts ${fmtDay(t.startsAt)}` : "Dates not set"}
          </span>
          {t.status === "REGISTRATION_OPEN" && t.registrationClosesAt && (
            <span className="flex items-center gap-1.5">
              <Hourglass className="size-3.5" /> Closes {fmtDay(t.registrationClosesAt)}
            </span>
          )}
          <ChevronRight className="ml-auto size-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

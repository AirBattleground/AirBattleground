import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, Crown, RefreshCw, SearchX, Trophy, Users } from "lucide-react";
import { TOURNAMENT_STATUSES, TOURNAMENT_STATUS_LABELS, type TournamentStatus, type TournamentSummary } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { SearchInput } from "@/components/SearchInput";
import { TournamentStatusPill } from "@/features/tournaments/components";
import { useAdminTournaments } from "@/features/tournaments/api";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Tournaments", description: "Every tournament on 7xen, from every manager. Managers create them without approval — you can step in on any of them." },
  { element: '[data-tour="t-filters"]', title: "Find one fast", description: "Search by name, or filter by status or by the manager who runs it.", side: "bottom" },
  { element: '[data-tour="t-list"]', title: "Open a tournament", description: "Click a tournament to see its format, registrations, groups and standings, and to take action.", side: "top" },
];

const ALL = "ALL";
/** Live-ish statuses first, then by newest. */
const ORDER: Record<TournamentStatus, number> = { LIVE: 0, REGISTRATION_OPEN: 1, REGISTRATION_CLOSED: 2, DRAFT: 3, COMPLETED: 4, CANCELLED: 5 };

function Filter({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full bg-card sm:w-auto sm:min-w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function stageLine(t: TournamentSummary) {
  if (t.champion) return <span className="inline-flex items-center gap-1"><Crown className="size-3.5 text-primary" /> {t.champion.name}</span>;
  if (t.currentStage) return `Stage ${t.currentStage.order}/${t.stagesCount} · ${t.currentStage.name}`;
  return `${t.stagesCount} ${t.stagesCount === 1 ? "stage" : "stages"}`;
}

function Row({ t, i }: { t: TournamentSummary; i: number }) {
  const fill = t.maxTeams ? Math.min(100, Math.round((t.confirmedCount / t.maxTeams) * 100)) : 0;
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
      <Link
        to={`/tournaments/${t.id}`}
        className="group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all outline-none hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-b from-primary/20 to-primary/5 text-primary">
            <Trophy className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-display text-lg font-bold">{t.title}</span>
              <TournamentStatusPill status={t.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>by {t.manager.displayName}</span>
              {t.prize && <span>Prize {t.prize}</span>}
              <span>{stageLine(t)}</span>
              <span>{t.startsAt ? `Starts ${shortDate(t.startsAt)}` : `Created ${relativeTime(t.createdAt)}`}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:w-56">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> Teams</span>
              <span>
                <strong className="font-display text-sm text-foreground">{t.confirmedCount}</strong> / {t.maxTeams}
                {t.waitlistCount > 0 && <> · +{t.waitlistCount} waiting</>}
              </span>
            </div>
            <Progress value={fill} className="h-1.5" />
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </Link>
    </motion.li>
  );
}

export default function TournamentsPage() {
  usePageTour("admin.tournaments", TOUR);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? ALL;
  const manager = params.get("manager") ?? ALL;
  const search = params.get("q") ?? "";
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (!v || v === ALL) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const list = useAdminTournaments();
  const all = list.data?.items ?? [];
  const managers = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of all) m.set(t.manager.id, t.manager.displayName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const q = search.trim().toLowerCase();
  const items = useMemo(
    () =>
      all
        .filter((t) => status === ALL || t.status === status)
        .filter((t) => manager === ALL || t.manager.id === manager)
        .filter((t) => !q || t.title.toLowerCase().includes(q) || t.manager.displayName.toLowerCase().includes(q))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt)),
    [all, status, manager, q],
  );
  const filtered = status !== ALL || manager !== ALL || !!q;

  let body: ReactNode;
  if (list.isPending) body = <ListSkeleton />;
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load tournaments"
        description={errorMessage(list.error)}
        action={<Button variant="outline" onClick={() => list.refetch()}><RefreshCw /> Try again</Button>}
      />
    );
  else if (!items.length)
    body = filtered ? (
      <EmptyState icon={<SearchX />} title="No tournaments match" description="Try another status or manager, or clear the search." action={<Button variant="outline" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>} />
    ) : (
      <EmptyState icon={<Trophy />} title="No tournaments yet" description="When a manager creates a tournament it shows up here. You don't need to approve it." />
    );
  else
    body = (
      <ul className="grid gap-3">
        {items.map((t, i) => (
          <Row key={t.id} t={t} i={i} />
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="Competitions" title="Tournaments" description="All tournaments from every manager. Open one to check it or step in." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-tour="t-filters">
        <SearchInput value={search} onChange={(v) => set("q", v)} placeholder="Search tournaments…" loading={list.isFetching && !list.isPending} />
        <Filter value={status} onChange={(v) => set("status", v)} label="Status" options={[[ALL, "All statuses"], ...TOURNAMENT_STATUSES.map((s) => [s, TOURNAMENT_STATUS_LABELS[s]] as [string, string])]} />
        <Filter value={manager} onChange={(v) => set("manager", v)} label="Manager" options={[[ALL, "All managers"], ...managers]} />
        {list.data && <p className="text-sm text-muted-foreground sm:ml-auto">{items.length} {items.length === 1 ? "tournament" : "tournaments"}{filtered && " found"}</p>}
      </div>
      <div data-tour="t-list">{body}</div>
    </>
  );
}

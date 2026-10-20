import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Crosshair, Drumstick, Flame, Swords } from "lucide-react";
import type { TeamResultsSummary } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { homeMsg } from "@/i18n/home";

function Cell({ icon, value, label, tone }: { icon: ReactNode; value: number; label: string; tone: string }) {
  return (
    <div className="relative rounded-xl border bg-background/60 p-3">
      <span className={cn("flex size-8 items-center justify-center rounded-lg [&_svg]:size-4", tone)}>{icon}</span>
      <p className="mt-2 font-display text-3xl leading-none font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/** The team's all-time numbers from published results (TeamDashboard.results). */
export function SeasonCard({ results, loading }: { results: TeamResultsSummary | null; loading: boolean }) {
  const t = useT(homeMsg);
  if (loading) return <Skeleton className="h-56 rounded-2xl" />;
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-tour="season">
      <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="relative flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold tracking-[0.25em] text-primary uppercase">{t("record_eyebrow")}</p>
          <p className="font-display text-xl font-bold">{t("record_title")}</p>
        </div>
        <Link to="/team/results" className="group inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
          {t("results")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      {results ? (
        <div className="relative mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Cell icon={<Swords />} value={results.sessionsPlayed} label={t("scrims_played")} tone="bg-primary/10 text-primary" />
          <Cell icon={<Flame />} value={results.matchesPlayed} label={t("matches")} tone="bg-primary/10 text-primary" />
          <Cell icon={<Crosshair />} value={results.totalKills} label={t("finishes")} tone="bg-destructive/10 text-destructive" />
          <Cell icon={<Drumstick />} value={results.wins} label={t("dinners")} tone="bg-warning/15 text-warning-foreground dark:text-warning" />
        </div>
      ) : (
        <p className="relative mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {t("record_empty")}
        </p>
      )}
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarSearch, Swords } from "lucide-react";
import { addDays, type TeamScrimOnDate } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { useTeamScrims } from "../api";
import { ScrimCard, ScrimCardSkeleton } from "../components/ScrimCard";
import { StaggerItem, StaggerList } from "../components/Stagger";
import { SectionHeader } from "./SectionHeader";

const GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))]";
const SHOW = 3;

/** Scrims worth showing on home: still taking teams, or ones the team already asked for. */
function joinable(items: TeamScrimOnDate[] | undefined): TeamScrimOnDate[] {
  return (items ?? [])
    .filter((s) => s.registrationOpen || (s.myRegistration && s.myRegistration.status !== "CANCELLED"))
    .sort((a, b) => Number(b.registrationOpen) - Number(a.registrationOpen) || a.startsAt.localeCompare(b.startsAt));
}

/** Today's and tomorrow's lists; exposed so the page can reuse them (organiser strip, hero art). */
export function useHomeScrims(today: string) {
  const tomorrow = addDays(today, 1);
  const t = useTeamScrims(today);
  const n = useTeamScrims(tomorrow);
  return {
    today: { date: today, items: joinable(t.data), loading: t.isLoading },
    tomorrow: { date: tomorrow, items: joinable(n.data), loading: n.isLoading },
  };
}

export function ScrimShowcase({ data }: { data: ReturnType<typeof useHomeScrims> }) {
  const [picked, setPicked] = useState<"today" | "tomorrow" | null>(null);
  // default to today, unless today has nothing left and tomorrow does
  const auto = !data.today.loading && data.today.items.length === 0 && data.tomorrow.items.length > 0 ? "tomorrow" : "today";
  const tab = picked ?? auto;
  const day = data[tab];
  const items = day.items.slice(0, SHOW);
  const more = day.items.length - items.length;
  const browse = tab === "today" ? "/team/scrims" : `/team/scrims?date=${day.date}`;

  return (
    <section className="space-y-4" data-tour="home-scrims">
      <SectionHeader eyebrow="Open for registration" title="Scrims you can join" icon={<Swords />} to={browse} linkLabel={more > 0 ? `See all ${day.items.length}` : "Browse scrims"} />

      <div role="tablist" aria-label="Which day" className="inline-flex rounded-full border bg-card/70 p-1 shadow-sm backdrop-blur">
        {(["today", "tomorrow"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setPicked(k)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              tab === k ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "today" ? "Today" : "Tomorrow"}
            {!data[k].loading && (
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === k ? "bg-primary-foreground/20" : "bg-muted")}>{data[k].items.length}</span>
            )}
          </button>
        ))}
      </div>

      {day.loading ? (
        <div className={GRID}>
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
        </div>
      ) : items.length === 0 ? (
        <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-dashed bg-card/60 p-6 text-center sm:flex-row sm:text-left">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
          <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CalendarSearch className="size-6" />
          </span>
          <div className="relative min-w-0 flex-1">
            <p className="font-display text-xl font-bold">No open scrims {tab === "today" ? "today" : "tomorrow"}</p>
            <p className="text-sm text-muted-foreground">Pick another day to see what's coming up — organisers add new scrims all the time.</p>
          </div>
          <Button asChild variant="outline" className="relative">
            <Link to={`/team/scrims?date=${addDays(day.date, 1)}`}>Look at other days</Link>
          </Button>
        </div>
      ) : (
        <StaggerList key={tab} className={GRID}>
          {items.map((s) => (
            <StaggerItem key={s.scrim.id} className="h-full">
              <ScrimCard item={s} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}

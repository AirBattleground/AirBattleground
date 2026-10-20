import { Link } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Plus } from "lucide-react";
import type { ManagerDashboard } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { formatDate, formatTime } from "@/features/manager/format";
import { AircraftFlyover, HudFrame, RadarScope, TacticalBackdrop, Ticker } from "../scenes";

/**
 * Lux-only "control room" banner that replaces the manager dashboard's PageHeader: greeting, the page's primary
 * action (New scrim) and a ticker of today's sessions. The numbers stay in the page's stat cards below (tour targets).
 * Data comes from the page's useDashboard().
 */
export default function LuxManagerHero({ name, greeting, data }: { name: string; greeting: string; data: ManagerDashboard | undefined }) {
  const pending = data?.pendingCount ?? 0;
  const line = !data
    ? "Checking your scrims…"
    : pending > 0
      ? `${pending} team${pending === 1 ? " is" : "s are"} waiting for your approval.`
      : "No teams waiting right now. You're all caught up.";
  const sessions = data ? [...data.todaySessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];
  const ticker = sessions.map((s) => (
    <span key={s.scrim.id}>
      <span className="text-primary">{formatTime(s.scrim.startTime)}</span> · {s.scrim.title} · {s.counts.approved}/{s.scrim.slotCount} slots
    </span>
  ));

  return (
    <MotionConfig reducedMotion="user">
      <HudFrame label="Control room" serial={data ? formatDate(data.today) : "Ops"} className="mt-2 mb-8">
        <section aria-label="Control room overview" className="relative isolate overflow-hidden border bg-card">
          <TacticalBackdrop seed={21} />
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <RadarScope className="absolute top-1/2 -right-20 w-64 -translate-y-1/2 opacity-40 sm:right-6 sm:w-56 sm:opacity-70 lg:right-12 lg:w-64" />
            <AircraftFlyover top="18%" angle={-4} duration={22} size={100} className="opacity-60" />
          </div>

          <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:pr-80">
            <div className="min-w-0">
              <p className="lux-sc-eyebrow lux-sc-rise flex items-center gap-2 font-mono text-primary">
                <span className="lux-sc-live-dot" aria-hidden /> {greeting}
              </p>
              <h1 className="lux-sc-rise lux-sc-stencil mt-3 line-clamp-2 font-display text-[2.1rem] leading-[0.95] break-words sm:text-6xl" style={{ ["--i" as string]: 1 }}>
                {name}
              </h1>
              <p className="lux-sc-rise mt-3 max-w-xl text-sm text-muted-foreground sm:text-base" style={{ ["--i" as string]: 2 }}>
                {line}
              </p>
              <Button asChild size="lg" data-tour="new-scrim" className="lux-sc-rise mt-5 h-12 w-full px-6 text-base sm:w-auto" style={{ ["--i" as string]: 3 }}>
                <Link to="/manager/scrims/new">
                  <Plus /> New scrim
                </Link>
              </Button>
            </div>
          </div>

          {ticker.length > 0 && <Ticker items={ticker} className="border-t py-2 text-muted-foreground" speed={Math.max(24, ticker.length * 9)} />}
        </section>
      </HudFrame>
    </MotionConfig>
  );
}

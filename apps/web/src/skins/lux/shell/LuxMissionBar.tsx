import { Fragment, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Crosshair, Radio } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem } from "@/components/shell";
import { gridRef, liveItemOf, useCrumbs } from "./useCrumbs";

const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Live IST clock (HH:mm:ss). Isolated so only this re-renders every second. */
function IstClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-1.5 tabular-nums" aria-label="Time in India">
      <span className="text-muted-foreground/70">IST</span>
      <time className="text-foreground/90">{IST.format(now)}</time>
    </span>
  );
}

/**
 * Thin strip under the top bar: breadcrumbs, a decorative grid reference, a live IST clock and a pulsing
 * LIVE pill (when the "live" nav item has a count).
 */
export function LuxMissionBar({ nav, segmentLabels, compact }: { nav: NavItem[]; segmentLabels: Record<string, string>; compact: boolean }) {
  const crumbs = useCrumbs(nav, segmentLabels);
  const { pathname } = useLocation();
  const live = liveItemOf(nav);

  return (
    <div className="lux-sh-mission relative flex h-9 items-center gap-3 border-b bg-card/55 px-4 font-mono text-[11px] tracking-[0.14em] uppercase backdrop-blur-md sm:px-6">
      <span aria-hidden className="lux-sh-mission-tick hidden shrink-0 text-primary sm:block">
        //
      </span>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={c.label + i}>
                <li className={cn("min-w-0 items-center gap-2", last ? "flex" : "hidden sm:flex")}>
                  {i > 0 && (
                    <span aria-hidden className="hidden text-primary/70 sm:inline">
                      ›
                    </span>
                  )}
                  {c.to ? (
                    <Link to={c.to} className="truncate text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:text-primary focus-visible:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="lux-sh-crumb-current truncate text-foreground">
                      {c.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      {!compact && (
        <span aria-hidden className="hidden shrink-0 items-center gap-1.5 text-muted-foreground md:flex">
          <Crosshair className="size-3.5 text-primary/80" />
          GRID <span className="text-foreground/90">{gridRef(pathname)}</span>
        </span>
      )}
      {!compact && <span aria-hidden className="lux-sh-mission-sep hidden h-3.5 w-px bg-border md:block" />}
      <IstClock />

      {live && (
        <Link
          to={live.to}
          aria-label={`Live now: ${live.badge} ${live.badge === 1 ? "match" : "matches"}`}
          className="lux-sh-live-pill flex h-6 shrink-0 items-center gap-1.5 bg-destructive/15 px-2 font-display text-[11px] tracking-[0.18em] text-destructive outline-none transition-colors hover:bg-destructive/25 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="lux-sh-live-dot relative size-2 rounded-full bg-destructive" />
          Live
          <span className="font-mono">{live.badge}</span>
          <Radio className="hidden size-3.5 sm:block" />
        </Link>
      )}
    </div>
  );
}

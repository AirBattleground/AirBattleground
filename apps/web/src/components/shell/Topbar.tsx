import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Compass } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { DATE_RE } from "@7xen/shared";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { LogoMark } from "@7xen/ui/components/brand/logo";
import { Button } from "@7xen/ui/components/ui/button";
import { useTour } from "@7xen/ui/tour";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem, ShellBrand } from "./types";
import { UserMenu } from "./UserMenu";

interface Crumb {
  label: string;
  to?: string;
}

const DEFAULT_SEGMENT_LABELS: Record<string, string> = { new: "New", edit: "Edit" };

/** Section from the best-matching nav item, then any deeper path segments. */
function useCrumbs(nav: NavItem[], segmentLabels: Record<string, string>): Crumb[] {
  const { pathname } = useLocation();
  return useMemo(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    const match = [...nav]
      .filter((n) => path === n.to || (!n.end && path.startsWith(n.to + "/")))
      .sort((a, b) => b.to.length - a.to.length)[0];
    if (!match) return [];
    const crumbs: Crumb[] = [{ label: match.label, to: match.to }];
    const rest = path.slice(match.to.length).split("/").filter(Boolean);
    let acc = match.to;
    rest.forEach((seg, i) => {
      acc += `/${seg}`;
      // an id right before a date (".../:scrimId/:date") is shown as the date crumb only
      if (DATE_RE.test(rest[i + 1] ?? "") && !segmentLabels[seg]) return;
      const label = DATE_RE.test(seg) ? format(parseISO(seg), "EEE, d MMM") : (segmentLabels[seg] ?? DEFAULT_SEGMENT_LABELS[seg] ?? "Details");
      crumbs.push({ label, to: acc });
    });
    // the last crumb is the current page — not a link
    const last = crumbs[crumbs.length - 1];
    if (last) delete last.to;
    return crumbs;
  }, [nav, pathname, segmentLabels]);
}

export function Topbar({ nav, segmentLabels, homeHref, compact, brand }: { nav: NavItem[]; segmentLabels: Record<string, string>; homeHref: string; compact: boolean; brand?: ShellBrand }) {
  const crumbs = useCrumbs(nav, segmentLabels);
  const tour = useTour();

  const startTour = () => {
    if (tour.hasTour()) tour.start();
    else toast.info("There's no tour for this page yet.");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55",
        compact ? "h-14 px-4" : "h-16 px-6",
      )}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
    >
      {compact && (
        <Link to={homeHref} aria-label={`${brand?.name ?? "7XEN"} home`} className="-ml-1 shrink-0 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {brand ? <img src={brand.mark} alt="" className="brand-ink h-8 w-auto" /> : <LogoMark className="size-8" />}
        </Link>
      )}

      {/* mobile: logo + actions only — the page name stays for screen readers (the page header shows it anyway) */}
      <nav aria-label="Breadcrumb" className={cn("min-w-0 flex-1", compact && "[&_ol]:sr-only")}>
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={c.label + i}>
                <li className={cn("min-w-0 items-center gap-1.5", last ? "flex" : "hidden sm:flex")}>
                  {i > 0 && <ChevronRight aria-hidden className="hidden size-4 shrink-0 text-muted-foreground/60 sm:block" />}
                  {c.to ? (
                    <Link to={c.to} className="truncate rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="block truncate font-display text-lg font-bold leading-none">
                      {c.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={startTour}
          data-tour="tour-btn"
          aria-label="Take a tour"
          className={cn("gap-2 border-primary/30 hover:border-primary/60", compact ? "size-9 p-0" : "h-9")}
        >
          <Compass className="size-4 text-primary" />
          {!compact && <span>Take a tour</span>}
        </Button>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

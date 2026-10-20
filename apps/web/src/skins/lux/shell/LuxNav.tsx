import { useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem } from "@/components/shell";

const GAP = 4; // px, matches gap-1

type Variant = "full" | "short";
interface Fit {
  variant: Variant;
  /** How many items stay in the bar; the rest go into "More". */
  count: number;
}

const labelOf = (item: NavItem, v: Variant) => (v === "short" ? (item.short ?? item.label) : item.label);
const badgeOf = (item: NavItem) => (item.badge && item.badge > 0 ? item.badge : 0);
const isActivePath = (item: NavItem, path: string) => path === item.to || (!item.end && path.startsWith(item.to + "/"));

function Badge({ n }: { n: number }) {
  return (
    <span className="lux-sh-chip-badge relative flex h-[18px] min-w-[18px] items-center justify-center bg-primary px-1 font-mono text-[10px] leading-none font-bold text-primary-foreground shadow-glow">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Inner content of a nav link; also used (invisible) to measure widths. */
function ItemBody({ item, variant, active }: { item: NavItem; variant: Variant; active: boolean }) {
  const Icon = item.icon;
  const badge = badgeOf(item);
  return (
    <>
      <Icon className={cn("relative size-4 shrink-0 transition-colors", active ? "text-primary drop-shadow-[0_0_6px_var(--glow)]" : "opacity-80")} />
      <span className="relative whitespace-nowrap">{labelOf(item, variant)}</span>
      {badge > 0 && <Badge n={badge} />}
    </>
  );
}

const LINK = "lux-sh-nav-link group relative flex h-10 shrink-0 items-center gap-2 px-3 font-display text-[13px] tracking-[0.08em] uppercase outline-none";

/**
 * Horizontal primary nav. Measures every item (full and short labels) in a hidden row and picks the
 * roomiest fit: full labels → short labels → short labels with the overflow tucked into a "More" menu.
 */
export function LuxNav({ nav }: { nav: NavItem[] }) {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "") || "/";
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ variant: "full", count: nav.length });

  const navSig = nav.map((n) => `${n.key}:${n.badge ?? 0}`).join("|");

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const compute = () => {
      const avail = wrap.clientWidth;
      const widths = (v: Variant) => Array.from(measure.querySelectorAll<HTMLElement>(`[data-m="${v}"]`)).map((el) => el.offsetWidth);
      const moreW = measure.querySelector<HTMLElement>("[data-m=more]")?.offsetWidth ?? 90;
      const total = (ws: number[]) => ws.reduce((a, b) => a + b, 0) + GAP * Math.max(0, ws.length - 1);
      const full = widths("full");
      const short = widths("short");
      let next: Fit;
      if (total(full) <= avail) next = { variant: "full", count: full.length };
      else if (total(short) <= avail) next = { variant: "short", count: short.length };
      else {
        let k = short.length - 1;
        while (k > 1 && total(short.slice(0, k)) + GAP + moreW > avail) k--;
        next = { variant: "short", count: k };
      }
      setFit((f) => (f.variant === next.variant && f.count === next.count ? f : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    ro.observe(measure);
    void document.fonts?.ready.then(compute);
    return () => ro.disconnect();
  }, [navSig]);

  const shown = nav.slice(0, fit.count);
  const overflow = nav.slice(fit.count);
  const overflowActive = overflow.some((i) => isActivePath(i, path));
  const overflowBadge = overflow.reduce((a, i) => a + badgeOf(i), 0);

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-center">
      {/* measuring row: same styles, never visible or focusable */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex w-max">
        {(["full", "short"] as const).map((v) =>
          nav.map((item) => (
            <span key={v + item.key} data-m={v} className={LINK}>
              <ItemBody item={item} variant={v} active />
            </span>
          )),
        )}
        <span data-m="more" className={LINK}>
          More <ChevronDown className="size-4" /> <Badge n={9} />
        </span>
      </div>

      <nav aria-label="Main" className="min-w-0">
        <ul className="flex items-center gap-1">
          {shown.map((item) => {
            const badge = badgeOf(item);
            const shortened = fit.variant === "short" && item.short && item.short !== item.label;
            return (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  data-tour={`nav-${item.key}`}
                  title={shortened ? item.label : undefined}
                  aria-label={shortened || badge ? `${item.label}${badge ? ` (${badge})` : ""}` : undefined}
                  className={({ isActive }: { isActive: boolean }) =>
                    cn(LINK, "transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50", isActive ? "is-active text-foreground" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {({ isActive }: { isActive: boolean }) => (
                    <>
                      <span aria-hidden className="lux-sh-nav-hover absolute inset-0" />
                      {isActive && (
                        <motion.span layoutId="lux-sh-nav-active" aria-hidden className="lux-sh-nav-active absolute inset-0" transition={{ type: "spring", stiffness: 480, damping: 38 }}>
                          <span className="lux-sh-nav-underline absolute inset-x-2 -bottom-[12px] h-[3px] bg-primary" />
                        </motion.span>
                      )}
                      <ItemBody item={item} variant={fit.variant} active={isActive} />
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          {overflow.length > 0 && (
            <li>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(LINK, "transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50", overflowActive ? "is-active text-foreground" : "text-muted-foreground hover:text-foreground data-[state=open]:text-foreground")}
                >
                  <span aria-hidden className="lux-sh-nav-hover absolute inset-0" />
                  {overflowActive && (
                    <motion.span layoutId="lux-sh-nav-active" aria-hidden className="lux-sh-nav-active absolute inset-0" transition={{ type: "spring", stiffness: 480, damping: 38 }}>
                      <span className="lux-sh-nav-underline absolute inset-x-2 -bottom-[12px] h-[3px] bg-primary" />
                    </motion.span>
                  )}
                  <span className="relative">More</span>
                  <ChevronDown className="relative size-4" />
                  {overflowBadge > 0 && <Badge n={overflowBadge} />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={10} className="w-56">
                  {overflow.map((item) => {
                    const Icon = item.icon;
                    const badge = badgeOf(item);
                    const active = isActivePath(item, path);
                    return (
                      <DropdownMenuItem key={item.key} asChild className={cn("cursor-pointer", active && "text-primary")}>
                        <Link to={item.to} data-tour={`nav-${item.key}`} aria-current={active ? "page" : undefined}>
                          <Icon className={cn(active && "text-primary")} />
                          <span className="flex-1">{item.label}</span>
                          {badge > 0 && <Badge n={badge} />}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}

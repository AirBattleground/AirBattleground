import { Link, NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { LogoMark } from "@7xen/ui/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem, SidebarSlot, SidebarSlotState, ShellBrand } from "./types";

/**
 * Collapse design: the sidebar content is laid out at full width and never reflows. Icons sit in a
 * fixed column (centre at RAIL/2), so collapsing only slides the rail edge in, fades labels, and
 * narrows each row's pill to the icon — nothing jumps.
 */
export const SIDEBAR_FULL = 264;
export const SIDEBAR_RAIL = 76;
/** Easing used by every collapse transition (fast start, soft landing — no spring overshoot). */
export const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

interface SidebarContentProps {
  nav: NavItem[];
  homeHref: string;
  collapsed: boolean;
  /** Distinct per rendering so active indicators don't animate between unrelated lists. */
  layoutId: string;
  header?: SidebarSlot;
  action?: SidebarSlot;
  brand?: ShellBrand;
}

/** Text that fades out when the rail collapses (and back in slightly after it expands). */
export function Fade({ collapsed, className, children }: { collapsed: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden={collapsed || undefined}
      className={cn("transition-opacity duration-200", collapsed ? "pointer-events-none opacity-0" : "opacity-100 delay-100", className)}
    >
      {children}
    </span>
  );
}

function NavRow({ item, collapsed, layoutId }: { item: NavItem; collapsed: boolean; layoutId: string }) {
  const Icon = item.icon;
  const badge = item.badge && item.badge > 0 ? item.badge : 0;
  const badgeText = badge > 99 ? "99+" : String(badge);
  return (
    // Tooltip is always mounted (only enabled when collapsed) so the row element — and its CSS
    // transitions — survive the toggle.
    <Tooltip open={collapsed ? undefined : false}>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          end={item.end}
          data-tour={`nav-${item.key}`}
          aria-label={collapsed ? (badge ? `${item.label} (${badge})` : item.label) : undefined}
          className={({ isActive }: { isActive: boolean }) =>
            cn(
              "group relative flex h-11 items-center gap-3 rounded-xl pr-3 pl-4 text-sm font-medium outline-none",
              "transition-[width,color] duration-300",
              EASE,
              "focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
              collapsed ? "w-[52px]" : "w-full",
              isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
            )
          }
        >
          {({ isActive }: { isActive: boolean }) => (
            <>
              <span
                aria-hidden
                className={cn(
                  "absolute inset-0 rounded-xl transition-colors duration-200",
                  !isActive && "group-hover:bg-sidebar-accent/50",
                )}
              />
              {isActive && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-xl border border-primary/25 bg-sidebar-accent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]"
                  transition={{ type: "spring", stiffness: 520, damping: 42 }}
                >
                  <span className="absolute top-1/2 -left-px h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-glow" />
                </motion.span>
              )}
              <span className="relative shrink-0">
                <Icon className={cn("size-5 transition-colors", isActive ? "text-primary" : "group-hover:text-foreground")} />
                <span
                  aria-hidden
                  className={cn(
                    "absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground ring-2 ring-sidebar transition-[opacity,transform] duration-200",
                    collapsed && badge ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  )}
                >
                  {badgeText}
                </span>
              </span>
              <Fade collapsed={collapsed} className="relative truncate whitespace-nowrap">
                {item.label}
              </Fade>
              {badge > 0 && (
                <Fade collapsed={collapsed} className="relative ml-auto">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-display text-xs leading-none font-bold text-primary-foreground shadow-glow">
                    {badgeText}
                  </span>
                </Fade>
              )}
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>
        {item.label}
        {badge > 0 && ` · ${badge}`}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({ nav, homeHref, collapsed, layoutId, header, action, brand }: SidebarContentProps) {
  const slot: SidebarSlotState = { collapsed, close: () => undefined };
  return (
    <div className="flex h-full flex-col" style={{ width: SIDEBAR_FULL }}>
      <div className="flex h-16 shrink-0 items-center pl-5">
        <Link
          to={homeHref}
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          aria-label={`${brand?.name ?? "7XEN"} home`}
        >
          {brand ? (
            // expanded: full wordmark; collapsed rail (76px): cross-fades to the compact mark
            <span className="relative block h-10">
              <Fade collapsed={collapsed} className="block h-full">
                <img src={brand.wordmarkInk} alt="" className="h-full w-auto dark:hidden" />
                <img src={brand.wordmark} alt="" className="hidden h-full w-auto dark:block" />
              </Fade>
              <img
                src={brand.mark}
                alt=""
                aria-hidden
                className={cn("absolute top-1/2 -left-1.5 h-7 w-auto -translate-y-1/2 transition-opacity duration-200", collapsed ? "opacity-100 delay-100" : "pointer-events-none opacity-0")}
              />
            </span>
          ) : (
            <>
              <LogoMark />
              <Fade collapsed={collapsed} className="leading-none">
                <span className="block font-display text-2xl font-bold tracking-wider">
                  7<span className="text-primary">XEN</span>
                </span>
                <span className="mt-0.5 block text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">Scrim Portal</span>
              </Fade>
            </>
          )}
        </Link>
      </div>

      {header && <div className="shrink-0 px-3 pb-2">{header(slot)}</div>}

      <nav aria-label="Main" className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <Fade collapsed={collapsed} className="mb-2 block px-4 text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">
          Menu
        </Fade>
        <ul className="flex flex-col gap-1">
          {nav.map((item) => (
            <li key={item.key}>
              <NavRow item={item} collapsed={collapsed} layoutId={layoutId} />
            </li>
          ))}
        </ul>
        {action && <div className="mt-4">{action(slot)}</div>}
      </nav>

      <Fade collapsed={collapsed} className="shrink-0 px-6 pb-4 text-[11px] text-muted-foreground">
        <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd> + <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">B</kbd> to collapse
      </Fade>
    </div>
  );
}

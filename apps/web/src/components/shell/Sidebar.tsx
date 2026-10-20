import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandPicker } from "@7xen/ui/components/brand/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import sidebarArtUrl from "@/assets/brand/sidebar-art.webp";
import type { NavItem, SidebarSlot, SidebarSlotState } from "./types";

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
  collapsed: boolean;
  onToggle: () => void;
  /** Distinct per rendering so active indicators don't animate between unrelated lists. */
  layoutId: string;
  header?: SidebarSlot;
  action?: SidebarSlot;
}

/**
 * Battlefield art behind the sidebar. The image is a portrait scene on its left ~60% that already fades to navy on
 * the right, so it's fitted to the expanded width (×1.25) and pinned bottom-left: the kneeling soldier lands in the
 * empty space above the footer, the drop (plane, chutes, town) rises behind the team card, and the top melts into
 * the sidebar colour so the nav stays clean. Fixed width, so collapsing just reveals the left slice (no reflow).
 */
export function SidebarArt({ collapsed }: { collapsed: boolean }) {
  return (
    <div aria-hidden className="sidebar-art pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-500">
      <img
        src={sidebarArtUrl}
        alt=""
        decoding="async"
        className={cn("absolute bottom-0 left-0 h-auto max-w-none opacity-35 transition-opacity duration-300 dark:opacity-100", collapsed && "dark:opacity-60")}
        style={{ width: SIDEBAR_FULL * 1.25 }}
      />
      {/* nav zone: solid sidebar colour, easing into the art below the menu */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--sidebar)_0%,color-mix(in_oklch,var(--sidebar)_92%,transparent)_30%,color-mix(in_oklch,var(--sidebar)_35%,transparent)_58%,color-mix(in_oklch,var(--sidebar)_10%,transparent)_78%,color-mix(in_oklch,var(--sidebar)_70%,transparent)_100%)]" />
      {/* keep the theme hue on the art */}
      <div className="absolute inset-0 bg-primary opacity-[0.06] mix-blend-color" />
    </div>
  );
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
              "group relative flex h-11 items-center gap-3 pr-3 pl-4 text-sm font-medium outline-none",
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
                  "absolute inset-0 transition-colors duration-200",
                  !isActive && "group-hover:bg-sidebar-accent/50",
                )}
              />
              {isActive && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0"
                  transition={{ type: "spring", stiffness: 520, damping: 42 }}
                >
                  {/* same pill as before, faded out toward the right so it melts into the sidebar */}
                  <span className="absolute inset-0 border border-primary/25 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--primary)_16%,var(--sidebar-accent))_0%,var(--sidebar-accent)_45%,transparent_100%)] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] [mask-image:linear-gradient(90deg,#000_55%,transparent_100%)]" />
                  <span className="absolute inset-y-0 -left-px w-[3px] bg-primary shadow-glow" />
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

export function SidebarContent({ nav, collapsed, onToggle, layoutId, header, action }: SidebarContentProps) {
  const slot: SidebarSlotState = { collapsed, close: () => undefined };
  return (
    <div className="flex h-full flex-col" style={{ width: SIDEBAR_FULL }}>
      {header && <div className="shrink-0 px-3 pt-4 pb-2">{header(slot)}</div>}

      <nav aria-label="Main" className="flex-1 overflow-x-hidden overflow-y-auto px-3 pt-4 pb-2">
        <ul className="flex flex-col gap-1">
          {nav.map((item) => (
            <li key={item.key}>
              <NavRow item={item} collapsed={collapsed} layoutId={layoutId} />
            </li>
          ))}
        </ul>
        {action && <div className="mt-4">{action(slot)}</div>}
      </nav>

      {/* footer: brand colour picker on the left, collapse toggle on the right (alone, in the icon column, when collapsed) */}
      <div className="relative flex h-14 shrink-0 items-center border-t border-sidebar-border px-5">
        <Fade collapsed={collapsed}>
          <BrandPicker />
        </Fade>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className={cn(
                "absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg border border-sidebar-border text-muted-foreground outline-none",
                "transition-[left,color,border-color,background-color] duration-300 hover:border-primary/50 hover:bg-sidebar-accent/50 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
                EASE,
              )}
              // expanded: right edge of the 264px column; collapsed: centred in the 76px rail
              style={{ left: collapsed ? SIDEBAR_RAIL / 2 - 18 : SIDEBAR_FULL - 12 - 36 }}
            >
              {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {collapsed ? "Expand" : "Collapse"} <span className="ml-1 opacity-60">Ctrl+B</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

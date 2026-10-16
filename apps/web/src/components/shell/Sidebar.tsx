import { Link, NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Logo, LogoMark } from "@7xen/ui/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem, SidebarSlot, SidebarSlotState } from "./types";

interface SidebarContentProps {
  nav: NavItem[];
  homeHref: string;
  collapsed: boolean;
  /** Distinct per rendering so the desktop and drawer active indicators don't fight. */
  layoutId: string;
  header?: SidebarSlot;
  action?: SidebarSlot;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
}

function BadgeCount({ count, collapsed }: { count: number; collapsed: boolean }) {
  const text = count > 99 ? "99+" : String(count);
  if (collapsed)
    return (
      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground ring-2 ring-sidebar">
        {text}
      </span>
    );
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-display text-xs font-bold leading-none text-primary-foreground shadow-glow">
      {text}
    </span>
  );
}

function NavRow({ item, collapsed, layoutId, onNavigate }: { item: NavItem; collapsed: boolean; layoutId: string; onNavigate?: () => void }) {
  const Icon = item.icon;
  const badge = item.badge && item.badge > 0 ? item.badge : 0;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      data-tour={`nav-${item.key}`}
      aria-label={collapsed ? (badge ? `${item.label} (${badge})` : item.label) : undefined}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          "group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
          "focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
          collapsed && "justify-center px-0",
          isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )
      }
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg border border-primary/25 bg-sidebar-accent"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            >
              <span className="absolute top-1/2 -left-px h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-glow" />
            </motion.span>
          )}
          <span className="relative">
            <Icon className={cn("size-5 transition-colors", isActive ? "text-primary" : "group-hover:text-foreground")} />
            {collapsed && badge > 0 && <BadgeCount count={badge} collapsed />}
          </span>
          {!collapsed && <span className="relative truncate">{item.label}</span>}
          {!collapsed && badge > 0 && (
            <span className="relative ml-auto">
              <BadgeCount count={badge} collapsed={false} />
            </span>
          )}
        </>
      )}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
        {badge > 0 && ` · ${badge}`}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({ nav, homeHref, collapsed, layoutId, header, action, onNavigate, onToggleCollapsed }: SidebarContentProps) {
  const slot: SidebarSlotState = { collapsed, close: onNavigate ?? (() => undefined) };
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "px-5")}>
        <Link to={homeHref} onClick={onNavigate} className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50" aria-label="7XEN home">
          {collapsed ? <LogoMark /> : <Logo subtitle="Scrim Portal" />}
        </Link>
      </div>

      {header && <div className={cn("shrink-0 pb-2", collapsed ? "px-2" : "px-3")}>{header(slot)}</div>}

      <nav aria-label="Main" className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-2" : "px-3")}>
        {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Menu</p>}
        <ul className="flex flex-col gap-1">
          {nav.map((item) => (
            <li key={item.key}>
              <NavRow item={item} collapsed={collapsed} layoutId={layoutId} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        {action && <div className="mt-4">{action(slot)}</div>}
      </nav>

      {onToggleCollapsed && (
        <div className={cn("shrink-0 border-t border-sidebar-border p-3", collapsed && "px-2")}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      )}
    </div>
  );
}

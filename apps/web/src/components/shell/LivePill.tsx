import { NavLink } from "react-router-dom";
import { cn } from "@7xen/ui/lib/utils";
import type { NavItem } from "./types";

/** The nav item phones show in the header instead of the tab bar (Live). */
export const headerItemOf = (nav: NavItem[]) => nav.find((n) => n.phoneHeaderWhileBadge);

/**
 * Phones: "● LIVE 2" in the header while something is on air (badge > 0); nothing otherwise. Keeps the tab bar at a
 * fixed set of tabs. Same `data-tour="nav-<key>"` target as the tab it replaces.
 */
export function LivePill({ item, className }: { item: NavItem | undefined; className?: string }) {
  const n = item?.badge ?? 0;
  if (!item || n <= 0) return null;
  return (
    <NavLink
      to={item.to}
      data-tour={`nav-${item.key}`}
      aria-label={`${item.label} (${n})`}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-destructive/60 bg-destructive/15 pr-2.5 pl-2 text-destructive outline-none transition-colors",
          "hover:bg-destructive/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95",
          isActive && "bg-destructive text-white",
          className,
        )
      }
    >
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-70" />
        <span className="relative size-2 rounded-full bg-current" />
      </span>
      <span className="font-display text-sm leading-none font-bold tracking-wider uppercase">{item.short ?? item.label}</span>
      <span className="font-display text-sm leading-none font-bold tabular-nums">{n > 99 ? "99+" : n}</span>
    </NavLink>
  );
}

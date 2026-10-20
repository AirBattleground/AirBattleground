import { Link, NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@7xen/ui/lib/utils";
import type { MobileAction, NavItem } from "@/components/shell";

/** Lux bottom navigation for phones/tablets (below lg). Same filtering + tour targets as the Teal MobileTabBar. */
export function LuxTabBar({ nav: all }: { nav: NavItem[] }) {
  const nav = all.filter((i) => !i.mobileOnlyWithBadge || (i.badge ?? 0) > 0);
  return (
    <nav aria-label="Main" className="lux-sh-tabbar fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <span aria-hidden className="lux-sh-hazard absolute inset-x-0 -top-px h-[2px]" />
      <ul className="mx-auto grid h-16 max-w-lg" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map((item) => {
          const Icon = item.icon;
          const badge = item.badge && item.badge > 0 ? item.badge : 0;
          return (
            <li key={item.key} className="min-w-0">
              <NavLink
                to={item.to}
                end={item.end}
                data-tour={`nav-${item.key}`}
                aria-label={badge ? `${item.label} (${badge})` : item.label}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    "relative flex h-full flex-col items-center justify-center gap-1 outline-none select-none [-webkit-tap-highlight-color:transparent]",
                    "transition-transform duration-150 focus-visible:bg-accent/40 active:scale-95",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive }: { isActive: boolean }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="lux-sh-tabbar-active"
                        aria-hidden
                        className="lux-sh-tab-active absolute inset-x-1.5 top-0 bottom-1"
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                      />
                    )}
                    <span className="relative flex h-7 w-full max-w-12 items-center justify-center">
                      <Icon className={cn("relative size-5 transition-transform duration-200", isActive && "scale-110 drop-shadow-[0_0_6px_var(--glow)]")} strokeWidth={isActive ? 2.4 : 2} />
                      {badge > 0 && (
                        <span className="lux-sh-chip-badge absolute -top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center bg-primary px-1 font-mono text-[10px] leading-none font-bold text-primary-foreground">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </span>
                    <span className={cn("relative max-w-full truncate px-1 text-[10px] leading-none tracking-[0.12em] uppercase", isActive ? "font-display" : "font-semibold")}>
                      {item.short ?? item.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Floating primary action above the tab bar (chamfered, glowing). */
export function LuxFab({ action }: { action: MobileAction }) {
  const Icon = action.icon;
  return (
    <Link
      to={action.to}
      data-tour={action.tour}
      aria-label={action.label}
      className="lux-sh-fab fixed right-4 z-40 flex size-14 items-center justify-center bg-primary text-primary-foreground shadow-glow outline-none transition-transform duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-90 [-webkit-tap-highlight-color:transparent]"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
    >
      <Icon className="size-6" />
    </Link>
  );
}

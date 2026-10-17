import { Link, NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@7xen/ui/lib/utils";
import type { MobileAction, NavItem } from "./types";

/** App-style bottom navigation for phones/tablets (below lg). Respects the iOS home-indicator inset. */
export function MobileTabBar({ nav }: { nav: NavItem[] }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/90"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
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
                    "focus-visible:bg-accent/40 active:scale-95 transition-transform duration-150",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive }: { isActive: boolean }) => (
                  <>
                    <span className="relative flex h-8 w-14 items-center justify-center">
                      {isActive && (
                        <motion.span
                          layoutId="tabbar-active"
                          className="absolute inset-0 rounded-full bg-primary/15 ring-1 ring-primary/25"
                          transition={{ type: "spring", stiffness: 520, damping: 40 }}
                        />
                      )}
                      <Icon className={cn("relative size-5 transition-transform duration-200", isActive && "scale-110")} strokeWidth={isActive ? 2.4 : 2} />
                      {badge > 0 && (
                        <span className="absolute top-0 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground ring-2 ring-background">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </span>
                    <span className={cn("max-w-full truncate px-1 text-[11px] leading-none", isActive ? "font-semibold" : "font-medium")}>
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

/** Floating primary action above the tab bar. */
export function MobileFab({ action }: { action: MobileAction }) {
  const Icon = action.icon;
  return (
    <Link
      to={action.to}
      data-tour={action.tour}
      aria-label={action.label}
      className="fixed right-4 z-40 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow outline-none transition-transform duration-150 active:scale-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 [-webkit-tap-highlight-color:transparent]"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
    >
      <Icon className="size-6" />
    </Link>
  );
}

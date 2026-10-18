import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useAuth } from "@/lib/auth";
import { readStorage, writeStorage } from "@/lib/storage";
import { useIsDesktop } from "@/lib/use-media-query";
import { EASE, SIDEBAR_FULL, SIDEBAR_RAIL, SidebarContent } from "./Sidebar";
import { MobileFab, MobileTabBar } from "./MobileTabBar";
import { Topbar } from "./Topbar";
import { WelcomeDialog } from "./WelcomeDialog";
import { useSessionExpiryToast } from "./useSessionExpiryToast";
import type { MobileAction, NavItem, SidebarSlot, ShellBrand, WelcomeStep } from "./types";

const COLLAPSED_KEY = "7xen.sidebar.collapsed";
const NO_LABELS: Record<string, string> = {};

export interface AppShellProps {
  nav: NavItem[];
  /** Where the logo links to, e.g. "/manager". */
  homeHref: string;
  /** Rendered under the logo (e.g. the team card). Desktop only. */
  sidebarHeader?: SidebarSlot;
  /** Rendered under the nav list (e.g. the "New scrim" button). Desktop only — use `mobileAction` for phones. */
  sidebarAction?: SidebarSlot;
  /** Floating action button on phones (e.g. "New scrim"). */
  mobileAction?: MobileAction;
  /** Breadcrumb labels for path segments below a nav item, e.g. { new: "New scrim" }. Unknown segments show "Details". */
  segmentLabels?: Record<string, string>;
  /** First-login welcome steps (dialog shows once per user per browser). */
  welcomeSteps?: WelcomeStep[];
  /** Image logo; defaults to the 7XEN mark. */
  brand?: ShellBrand;
  children: ReactNode;
}

export function AppShell({ nav, homeHref, sidebarHeader, sidebarAction, mobileAction, segmentLabels = NO_LABELS, welcomeSteps, brand, children }: AppShellProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(() => readStorage(COLLAPSED_KEY) === "1");
  useSessionExpiryToast();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      writeStorage(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  // Ctrl/⌘ + B toggles the sidebar (desktop)
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, toggleCollapsed]);

  // new page → start at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex min-h-dvh bg-background">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <AnimatedBackground />
        </div>

        {/* Desktop sidebar — only mounted on desktop so tour steps never target a hidden element */}
        {isDesktop && (
          <aside
            className={cn("group/sidebar sticky top-0 z-20 h-dvh shrink-0 border-r border-sidebar-border bg-sidebar/80 text-sidebar-foreground backdrop-blur-xl transition-[width] duration-300", EASE)}
            style={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_FULL }}
          >
            <div className="h-full overflow-hidden">
              <SidebarContent nav={nav} homeHref={homeHref} collapsed={collapsed} layoutId="nav-active-desktop" header={sidebarHeader} action={sidebarAction} brand={brand} />
            </div>
            {/* edge toggle: sits on the border, always reachable */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  className={cn(
                    "absolute top-[22px] -right-3.5 z-30 flex size-7 items-center justify-center rounded-full border border-sidebar-border bg-card text-muted-foreground shadow-md outline-none",
                    "transition-[color,border-color,box-shadow,opacity] duration-200 hover:border-primary/50 hover:text-primary hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
                    "opacity-70 group-hover/sidebar:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <ChevronLeft className={cn("size-4 transition-transform duration-300", EASE, collapsed && "rotate-180")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {collapsed ? "Expand" : "Collapse"} <span className="ml-1 opacity-60">Ctrl+B</span>
              </TooltipContent>
            </Tooltip>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar nav={nav} segmentLabels={segmentLabels} homeHref={homeHref} compact={!isDesktop} brand={brand} />
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 outline-none"
            // phones: keep content clear of the bottom tab bar (+ iOS home indicator)
            style={isDesktop ? undefined : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
          >
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
            >
              {children}
            </motion.div>
          </main>
        </div>

        {!isDesktop && <MobileTabBar nav={nav} />}
        {!isDesktop && mobileAction && <MobileFab action={mobileAction} />}

        {user && welcomeSteps && <WelcomeDialog key={user.id} user={user} steps={welcomeSteps} />}
      </div>
    </MotionConfig>
  );
}

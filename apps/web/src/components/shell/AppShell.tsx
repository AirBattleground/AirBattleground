import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@7xen/ui/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { readStorage, writeStorage } from "@/lib/storage";
import { useIsDesktop } from "@/lib/use-media-query";
import { SidebarContent } from "./Sidebar";
import { Topbar } from "./Topbar";
import { WelcomeDialog } from "./WelcomeDialog";
import { useSessionExpiryToast } from "./useSessionExpiryToast";
import type { NavItem, SidebarSlot, WelcomeStep } from "./types";

const COLLAPSED_KEY = "7xen.sidebar.collapsed";
const NO_LABELS: Record<string, string> = {};

export interface AppShellProps {
  nav: NavItem[];
  /** Where the logo links to, e.g. "/manager". */
  homeHref: string;
  /** Rendered under the logo (e.g. the team card). */
  sidebarHeader?: SidebarSlot;
  /** Rendered under the nav list (e.g. the "New scrim" button). */
  sidebarAction?: SidebarSlot;
  /** Breadcrumb labels for path segments below a nav item, e.g. { new: "New scrim" }. Unknown segments show "Details". */
  segmentLabels?: Record<string, string>;
  /** First-login welcome steps (dialog shows once per user per browser). */
  welcomeSteps?: WelcomeStep[];
  children: ReactNode;
}

export function AppShell({ nav, homeHref, sidebarHeader, sidebarAction, segmentLabels = NO_LABELS, welcomeSteps, children }: AppShellProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(() => readStorage(COLLAPSED_KEY) === "1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  useSessionExpiryToast();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      writeStorage(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  // close the drawer when navigating or growing to desktop
  useEffect(() => setDrawerOpen(false), [pathname, isDesktop]);
  // new page → start at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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
          <motion.aside
            initial={false}
            animate={{ width: collapsed ? 76 : 264 }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            className="sticky top-0 z-20 h-dvh shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar/80 text-sidebar-foreground backdrop-blur-xl"
          >
            <SidebarContent
              nav={nav}
              homeHref={homeHref}
              collapsed={collapsed}
              layoutId="nav-active-desktop"
              header={sidebarHeader}
              action={sidebarAction}
              onToggleCollapsed={toggleCollapsed}
            />
          </motion.aside>
        )}

        {/* Mobile drawer */}
        {!isDesktop && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
              <SidebarContent
                nav={nav}
                homeHref={homeHref}
                collapsed={false}
                layoutId="nav-active-mobile"
                header={sidebarHeader}
                action={sidebarAction}
                onNavigate={closeDrawer}
              />
            </SheetContent>
          </Sheet>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar nav={nav} segmentLabels={segmentLabels} onOpenMenu={() => setDrawerOpen(true)} showMenuButton={!isDesktop} />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
            >
              {children}
            </motion.div>
          </main>
        </div>

        {user && welcomeSteps && <WelcomeDialog key={user.id} user={user} steps={welcomeSteps} />}
      </div>
    </MotionConfig>
  );
}

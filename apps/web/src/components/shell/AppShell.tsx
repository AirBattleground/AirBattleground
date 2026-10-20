import { lazy, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { cn } from "@7xen/ui/lib/utils";
import { useAuth } from "@/lib/auth";
import { readStorage, writeStorage } from "@/lib/storage";
import { useIsDesktop } from "@/lib/use-media-query";
import { EASE, SIDEBAR_FULL, SIDEBAR_RAIL, SidebarArt, SidebarContent } from "./Sidebar";
import { MobileFab, MobileTabBar } from "./MobileTabBar";
import { Topbar } from "./Topbar";
import { WelcomeDialog } from "./WelcomeDialog";
import { useSessionExpiryToast } from "./useSessionExpiryToast";
import { SkinSwitch } from "@/lib/skin";
import type { MobileAction, NavItem, SidebarSlot, ShellBrand, WelcomeStep } from "./types";

const COLLAPSED_KEY = "7xen.sidebar.collapsed";

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
  /** Image logo; defaults to the AirBattleground mark. */
  brand?: ShellBrand;
  /** Header search (e.g. the team quick-jump). Renders its own desktop field / phone icon. */
  search?: ReactNode;
  /** Header alerts (e.g. the team bell). */
  notifications?: ReactNode;
  children: ReactNode;
}

/** The web portal's logo set (header + phone bar), shared by the team and manager areas. */
const WEB_BRAND: ShellBrand = { name: "AirBattleground", mark: markUrl, wordmark: wordmarkUrl, wordmarkInk: wordmarkInkUrl };

const LuxShell = lazy(() => import("@/skins/lux/shell/LuxShell"));

/** Teal Battle = the sidebar shell below; Lux Battle = src/skins/lux/shell (same props). Picked by the site skin. */
export function AppShell(props: AppShellProps) {
  return <SkinSwitch teal={<TealShell {...props} />} lux={<LuxShell {...props} />} />;
}

function TealShell({ nav, homeHref, sidebarHeader, sidebarAction, mobileAction, welcomeSteps, brand: brandProp, search, notifications, children }: AppShellProps) {
  // every area (manager, player) shows the same AirBattleground logo unless a layout passes its own
  const brand = brandProp ?? WEB_BRAND;
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
      {/* --shell-top: header height; pages can bleed art up under the see-through header with it */}
      <div
        className="relative isolate flex min-h-dvh bg-background pt-[var(--shell-top)]"
        style={{ "--shell-top": `calc(${isDesktop ? "4rem" : "3.5rem"} + env(safe-area-inset-top, 0px))` } as CSSProperties}
      >
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <AnimatedBackground />
        </div>
        {/* full-window art slot behind header, sidebar and page (filled via portal, e.g. a tournament's poster) */}
        <div id="app-backdrop" aria-hidden className="pointer-events-none fixed inset-0 -z-10 empty:hidden" />

        {/* Desktop sidebar — only mounted on desktop so tour steps never target a hidden element */}
        {isDesktop && (
          <aside
            className={cn("sticky top-[var(--shell-top)] z-20 h-[calc(100dvh-var(--shell-top))] shrink-0 border-r border-sidebar-border bg-sidebar/80 text-sidebar-foreground backdrop-blur-xl transition-[width] duration-300", EASE)}
            style={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_FULL }}
          >
            <SidebarArt collapsed={collapsed} />
            <div className="relative h-full overflow-hidden">
              <SidebarContent nav={nav} collapsed={collapsed} onToggle={toggleCollapsed} layoutId="nav-active-desktop" header={sidebarHeader} action={sidebarAction} />
            </div>
          </aside>
        )}

        <Topbar
          homeHref={homeHref}
          compact={!isDesktop}
          brand={brand}
          collapsed={collapsed}
          brandWidth={collapsed ? SIDEBAR_RAIL : SIDEBAR_FULL}
          search={search}
          notifications={notifications}
        />

        <div className="flex min-w-0 flex-1 flex-col">
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
              className="w-full px-4 py-4 sm:px-5 sm:py-5 lg:px-6"
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

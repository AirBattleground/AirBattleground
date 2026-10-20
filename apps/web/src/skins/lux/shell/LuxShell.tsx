import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { BRAND_ASSETS } from "@7xen/ui/components/brand/logo";
import { useAuth } from "@/lib/auth";
import { useIsDesktop, useMediaQuery } from "@/lib/use-media-query";
import { WelcomeDialog } from "@/components/shell/WelcomeDialog";
import { useSessionExpiryToast } from "@/components/shell/useSessionExpiryToast";
import type { AppShellProps } from "@/components/shell";
import { LuxBackdrop } from "./LuxBackdrop";
import { LuxTopBar } from "./LuxTopBar";
import { LuxMissionBar } from "./LuxMissionBar";
import { LuxFooter } from "./LuxFooter";
import { LuxFab, LuxTabBar } from "./LuxTabBar";

const NO_LABELS: Record<string, string> = {};
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Lux Battle shell: a branded site with everything on top — sticky top bar (logo, nav, team chip, CTA,
 * tour, theme, account), a mission bar (breadcrumbs, grid ref, IST clock, LIVE), the tactical backdrop,
 * and a site footer. Phones get a compact top bar, the Lux tab bar and the FAB. Same props as Teal.
 */
export default function LuxShell({ nav, homeHref, sidebarHeader, sidebarAction, mobileAction, segmentLabels = NO_LABELS, welcomeSteps, brand: brandProp, children }: AppShellProps) {
  const brand = brandProp ?? BRAND_ASSETS;
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const wide = useMediaQuery("(min-width: 1280px)");
  const xwide = useMediaQuery("(min-width: 1800px)");
  useSessionExpiryToast();

  // new page → start at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="lux-sh-shell relative isolate flex min-h-dvh flex-col bg-background">
        <a
          href="#main"
          className="sr-only z-[60] bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <LuxBackdrop />

        <header className="lux-sh-header sticky top-0 z-30 shrink-0" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="lux-sh-header-bar border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
            <LuxTopBar nav={nav} homeHref={homeHref} brand={brand} compact={!isDesktop} wide={wide} xwide={xwide} sidebarHeader={sidebarHeader} sidebarAction={sidebarAction} />
          </div>
          <span aria-hidden className="lux-sh-hazard lux-sh-hazard-move absolute inset-x-0 h-[3px]" />
          <LuxMissionBar nav={nav} segmentLabels={segmentLabels} compact={!isDesktop} />
        </header>

        {/* phones: keep content + footer clear of the bottom tab bar (+ iOS home indicator) */}
        <div className="flex flex-1 flex-col" style={isDesktop ? undefined : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}>
          <main id="main" tabIndex={-1} className="relative flex-1 outline-none">
            <motion.div
              key={pathname}
              // transform/opacity only (a lingering filter would trap position:fixed children)
              initial={{ opacity: 0, y: 14, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="w-full px-4 py-4 sm:px-5 sm:py-5 lg:px-6"
            >
              {children}
            </motion.div>
            {/* one-shot scan line sweeping down on every route change */}
            <span key={`scan-${pathname}`} aria-hidden className="lux-sh-route-scan pointer-events-none absolute inset-x-0 top-0 h-24" />
          </main>
          <LuxFooter nav={nav} brand={brand} homeHref={homeHref} />
        </div>

        {!isDesktop && <LuxTabBar nav={nav} />}
        {!isDesktop && mobileAction && <LuxFab action={mobileAction} />}

        {user && welcomeSteps && <WelcomeDialog key={user.id} user={user} steps={welcomeSteps} />}
      </div>
    </MotionConfig>
  );
}

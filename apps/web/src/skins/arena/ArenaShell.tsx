import { useEffect, type CSSProperties } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useTour } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useIsDesktop } from "@/lib/use-media-query";
import type { AppShellProps } from "@/components/shell";
import { MobileFab, MobileTabBar } from "@/components/shell/MobileTabBar";
import { UserMenu } from "@/components/shell/UserMenu";
import { WelcomeDialog } from "@/components/shell/WelcomeDialog";
import { useSessionExpiryToast } from "@/components/shell/useSessionExpiryToast";
import { BgCoin } from "@/features/coins/components/BgCoin";
import { useCoinLeaderboard } from "@/features/coins/components/CoinLeaderboard";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";

/** Players' wallet in the HUD: the team's BG coins, opening the coins page. */
function CoinPill({ compact }: { compact?: boolean }) {
  const mine = useCoinLeaderboard().data?.myTeam;
  return (
    <Link
      to="/team/coins"
      data-tour="arena-coins"
      aria-label={`BG coins: ${mine?.coins ?? 0}`}
      className="flex items-center gap-2 border border-warning/45 bg-warning/10 py-1 pr-3 pl-1.5 outline-none transition-colors hover:bg-warning/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <BgCoin className={compact ? "size-5" : "size-6"} shine />
      <span className={cn("font-display leading-none font-semibold tabular-nums", compact ? "text-lg" : "text-xl")}>{(mine?.coins ?? 0).toLocaleString("en-IN")}</span>
    </Link>
  );
}

/**
 * Arena shell: a game HUD instead of a website — fixed top bar with the mode tabs (uppercase, glowing underline,
 * live counts), the player's BG coins, alerts, tour, theme and account; phones get a compact HUD and the bottom dock.
 * Same props as Teal (sidebar slots aren't used: the lobby carries the squad + coins).
 */
export default function ArenaShell({ nav, homeHref, mobileAction, welcomeSteps, search, notifications, children }: AppShellProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const tour = useTour();
  const player = user?.role === "PLAYER";
  useSessionExpiryToast();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const startTour = () => {
    if (tour.hasTour()) tour.start();
    else toast.info("There's no tour for this page yet.");
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="relative isolate flex min-h-dvh flex-col bg-background pt-[var(--shell-top)]"
        style={{ "--shell-top": `calc(${isDesktop ? "4.5rem" : "3.5rem"} + env(safe-area-inset-top, 0px))` } as CSSProperties}
      >
        <a href="#main" className="sr-only z-50 bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        {/* lobby backdrop: HUD grid + teal glow */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <div className="arena-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_50%_30%,#000,transparent_70%)]" />
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        </div>
        <div id="app-backdrop" aria-hidden className="pointer-events-none fixed inset-0 -z-10 empty:hidden" />

        <header
          className="fixed inset-x-0 top-0 z-40 border-b border-border bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_96%,transparent),color-mix(in_oklch,var(--background)_78%,transparent))] backdrop-blur-xl"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          <div className={cn("flex items-center gap-3", isDesktop ? "h-[4.5rem] px-6" : "h-14 px-3")}>
            <Link to={homeHref} aria-label="AirBattleground home" className="shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {isDesktop ? (
                <>
                  <img src={wordmarkInkUrl} alt="" className="brand-ink h-10 w-auto dark:hidden" />
                  <img src={wordmarkUrl} alt="" className="brand-ink hidden h-10 w-auto dark:block" />
                </>
              ) : (
                <img src={markUrl} alt="" className="brand-ink h-8 w-auto" />
              )}
            </Link>

            {isDesktop && (
              <nav aria-label="Main" className="ml-4 flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]">
                {nav.map((item) => {
                  const badge = item.badge && item.badge > 0 ? item.badge : 0;
                  return (
                    <NavLink
                      key={item.key}
                      to={item.to}
                      end={item.end}
                      data-tour={`nav-${item.key}`}
                      className={({ isActive }: { isActive: boolean }) =>
                        cn(
                          "relative flex h-[4.5rem] shrink-0 items-center gap-1.5 px-3 font-display text-lg font-semibold tracking-[0.12em] uppercase transition-colors outline-none focus-visible:bg-accent/40 xl:px-4",
                          isActive ? "arena-tab-on text-foreground" : "text-muted-foreground hover:text-foreground",
                        )
                      }
                    >
                      {item.short ?? item.label}
                      {badge > 0 && (
                        <span className={cn("rounded-full px-1.5 font-sans text-[11px] leading-4 font-bold tracking-normal", item.key === "live" ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}>
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
            )}

            <div className={cn("flex shrink-0 items-center gap-1.5", !isDesktop && "ml-auto")}>
              {isDesktop && search && <div className="hidden w-56 2xl:block">{search}</div>}
              {player && <CoinPill compact={!isDesktop} />}
              {notifications}
              {isDesktop && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={startTour} data-tour="tour-btn" aria-label="Take a tour" className="size-9 text-muted-foreground hover:text-primary">
                      <Compass className="size-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Take a tour</TooltipContent>
                </Tooltip>
              )}
              <LanguageSwitch />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 outline-none"
          style={isDesktop ? undefined : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
        >
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full px-4 py-4 sm:px-5 sm:py-5 lg:px-6"
          >
            {children}
          </motion.div>
        </main>

        {!isDesktop && <MobileTabBar nav={nav} />}
        {!isDesktop && mobileAction && <MobileFab action={mobileAction} />}
        {user && welcomeSteps && <WelcomeDialog key={user.id} user={user} steps={welcomeSteps} />}
      </div>
    </MotionConfig>
  );
}

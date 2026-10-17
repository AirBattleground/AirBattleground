import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Compass, GraduationCap, LayoutDashboard, LogOut, Shield, ShieldCheck, Smartphone, Trophy, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { LogoMark } from "@7xen/ui/components/brand/logo";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@7xen/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useTour } from "@7xen/ui/tour";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useAuth } from "@/lib/auth";
import { useAdminStats } from "@/features/stats/api";
import { useSamples } from "@/features/training/api";

interface NavDef {
  to: string;
  label: string;
  /** label in the phone tab bar */
  short: string;
  icon: LucideIcon;
  tour: string;
  end: boolean;
  /** hidden from the 5-slot phone tab bar (reachable from another tab instead) */
  desktopOnly?: boolean;
  /** phone tab bar: also highlight this tab (and add their badges) on these routes */
  mobileAlso?: string[];
}

const NAV: NavDef[] = [
  { to: "/", label: "Overview", short: "Home", icon: LayoutDashboard, tour: "nav-overview", end: true },
  { to: "/managers", label: "Managers", short: "Managers", icon: Users, tour: "nav-managers", end: false },
  { to: "/teams", label: "Teams", short: "Teams", icon: Shield, tour: "nav-teams", end: false, mobileAlso: ["/team-requests"] },
  // Phones: approvals fold into the Teams tab (badge + highlight carry over; Teams page links to it).
  { to: "/team-requests", label: "Team approvals", short: "Approvals", icon: ShieldCheck, tour: "nav-team-requests", end: false, desktopOnly: true },
  { to: "/tournaments", label: "Tournaments", short: "Tourneys", icon: Trophy, tour: "nav-tournaments", end: false },
  { to: "/training", label: "Training", short: "Training", icon: GraduationCap, tour: "nav-training", end: false },
  // Phones: reachable from the Overview "Manager app" card (the tab bar keeps 5 items).
  { to: "/manager-app", label: "Manager app", short: "App", icon: Smartphone, tour: "nav-manager-app", end: false, desktopOnly: true },
];

const COLLAPSE_KEY = "7xen.admin.sidebar-collapsed";
/** Collapse design (same as the portal): content is laid out at full width, icons sit in a fixed
 *  column, collapsing slides the rail edge, fades labels and narrows the pills — nothing jumps. */
const FULL = 256;
const RAIL = 76;
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

function titleFor(pathname: string) {
  const item = [...NAV].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return item?.label ?? "Admin";
}

function useBadges(): Record<string, number> {
  const stats = useAdminStats({ refetchInterval: 30_000 });
  const samples = useSamples();
  return {
    "/team-requests": stats.data?.teamRequests.pending ?? 0,
    "/training": samples.data?.items.filter((s) => !s.verified && !s.excluded).length ?? 0,
  };
}

function Fade({ collapsed, className, children }: { collapsed: boolean; className?: string; children: ReactNode }) {
  return (
    <span aria-hidden={collapsed || undefined} className={cn("transition-opacity duration-200", collapsed ? "pointer-events-none opacity-0" : "opacity-100 delay-100", className)}>
      {children}
    </span>
  );
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const badges = useBadges();
  return (
    <nav className="grid gap-1" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon, tour, end }) => {
        const badge = badges[to] ?? 0;
        return (
          // always mounted (enabled only when collapsed) so the link keeps its CSS transitions
          <Tooltip key={to} open={collapsed ? undefined : false}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end={end}
                data-tour={tour}
                aria-label={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    "group relative flex h-11 items-center gap-3 rounded-xl pr-3 pl-4 text-sm font-medium outline-none",
                    "transition-[width,color] duration-300 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    EASE,
                    collapsed ? "w-[52px]" : "w-full",
                    isActive ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:text-sidebar-foreground",
                  )
                }
              >
                {({ isActive }: { isActive: boolean }) => (
                  <>
                    <span aria-hidden className={cn("absolute inset-0 rounded-xl transition-colors duration-200", !isActive && "group-hover:bg-sidebar-accent/50")} />
                    {isActive && (
                      <motion.span
                        layoutId="admin-nav-active"
                        className="absolute inset-0 rounded-xl border border-primary/25 bg-sidebar-accent"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                      >
                        <span className="absolute top-1/2 -left-px h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-glow" />
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
                        {badge > 99 ? "99+" : badge}
                      </span>
                    </span>
                    <Fade collapsed={collapsed} className="relative truncate whitespace-nowrap">
                      {label}
                    </Fade>
                    {badge > 0 && (
                      <Fade collapsed={collapsed} className="relative ml-auto">
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-display text-xs leading-none font-bold text-primary-foreground shadow-glow">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      </Fade>
                    )}
                  </>
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={12}>
              {label}
              {badge > 0 && ` · ${badge}`}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

/** App-style bottom navigation for phones/tablets. */
function MobileTabBar() {
  const badges = useBadges();
  const { pathname } = useLocation();
  const items = NAV.filter((n) => !n.desktopOnly);
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/90"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {items.map(({ to, label, short, icon: Icon, tour, end, mobileAlso = [] }) => {
          const badge = (badges[to] ?? 0) + mobileAlso.reduce((n, p) => n + (badges[p] ?? 0), 0);
          const alsoActive = mobileAlso.some((p) => pathname.startsWith(p));
          return (
            <li key={to} className="min-w-0">
              <NavLink
                to={to}
                end={end}
                data-tour={tour}
                aria-label={badge ? `${label} (${badge})` : label}
                className={({ isActive: routeActive }: { isActive: boolean }) =>
                  cn(
                    "relative flex h-full flex-col items-center justify-center gap-1 outline-none select-none transition-transform duration-150 active:scale-95 focus-visible:bg-accent/40",
                    routeActive || alsoActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive: routeActive }: { isActive: boolean }) => {
                  const isActive = routeActive || alsoActive;
                  return (
                  <>
                    <span className="relative flex h-8 w-14 items-center justify-center">
                      {isActive && (
                        <motion.span
                          layoutId="admin-tab-active"
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
                    <span className={cn("max-w-full truncate px-1 text-[11px] leading-none", isActive ? "font-semibold" : "font-medium")}>{short}</span>
                  </>
                  );
                }}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserMenu({ compact }: { compact: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg p-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:pr-2"
          aria-label="Account menu"
        >
          <TeamAvatar name={user.displayName} size="sm" />
          {!compact && <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{user.displayName}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate font-medium">{user.displayName}</div>
          <div className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-primary uppercase">{user.role}</span>
            <span className="truncate font-mono">@{user.username}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await logout();
            toast.success("Signed out. See you next match!");
            navigate("/login", { replace: true });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Freezes the outlet so the exiting page keeps rendering its own content during the exit animation. */
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}

function TopBar({ title, compact }: { title: ReactNode; compact: boolean }) {
  const { start } = useTour();
  return (
    <header
      className={cn("sticky top-0 z-30 flex items-center gap-3 border-b bg-background/75 backdrop-blur-xl", compact ? "h-14 px-4" : "h-16 px-6")}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
    >
      {compact && (
        <NavLink to="/" aria-label="7xen admin home" className="-ml-1 shrink-0 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <LogoMark className="size-8" />
        </NavLink>
      )}
      <div className="min-w-0 flex-1">
        {!compact && <div className="text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">Admin Console</div>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={String(title)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="truncate font-display text-lg leading-tight font-bold"
          >
            {title}
          </motion.div>
        </AnimatePresence>
      </div>
      <Button variant="outline" size="sm" onClick={start} data-tour="tour-btn" aria-label="Take a tour" className={cn("gap-1.5", compact && "size-9 p-0")}>
        <Compass className="text-primary" />
        {!compact && <span>Take a tour</span>}
      </Button>
      <ThemeToggle />
      <UserMenu compact={compact} />
    </header>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  // Ctrl/⌘ + B toggles the sidebar
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, toggle]);

  const title = titleFor(location.pathname);
  useEffect(() => {
    document.title = `${title} · 7XEN Admin`;
  }, [title]);

  return (
    <div className="relative isolate flex min-h-dvh">
      <AnimatedBackground intensity="subtle" className="fixed" />

      {isDesktop && (
        <aside
          className={cn("group/sidebar sticky top-0 z-20 h-dvh shrink-0 border-r bg-sidebar/85 backdrop-blur-xl transition-[width] duration-300", EASE)}
          style={{ width: collapsed ? RAIL : FULL }}
        >
          <div className="h-full overflow-hidden">
            <div className="flex h-full flex-col gap-6 px-3 py-4" style={{ width: FULL }}>
              <NavLink to="/" aria-label="7xen admin home" className="flex h-10 items-center gap-2.5 rounded-lg pl-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <LogoMark />
                <Fade collapsed={collapsed} className="leading-none">
                  <span className="block font-display text-2xl font-bold tracking-wider">
                    7<span className="text-primary">XEN</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">Admin Console</span>
                </Fade>
              </NavLink>
              <SidebarNav collapsed={collapsed} />
              <Fade collapsed={collapsed} className="mt-auto block">
                <span className="block rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
                  <span className="mb-1 block font-display text-sm font-bold text-foreground">You're in control</span>
                  You create manager logins and approve teams managers register.
                  <span className="mt-2 block text-[11px]">
                    <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd> + <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">B</kbd> collapses the menu
                  </span>
                </span>
              </Fade>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                className={cn(
                  "absolute top-[22px] -right-3.5 z-30 flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-md outline-none",
                  "opacity-70 transition-[color,border-color,box-shadow,opacity] duration-200 group-hover/sidebar:opacity-100 hover:border-primary/50 hover:text-primary hover:shadow-glow focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
        <TopBar title={title} compact={!isDesktop} />
        <main
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
          style={isDesktop ? undefined : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <FrozenOutlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {!isDesktop && <MobileTabBar />}
    </div>
  );
}

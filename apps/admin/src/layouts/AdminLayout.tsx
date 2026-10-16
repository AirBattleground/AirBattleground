import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, GraduationCap, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Shield, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Logo, LogoMark } from "@7xen/ui/components/brand/logo";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@7xen/ui/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useTour } from "@7xen/ui/tour";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useAuth } from "@/lib/auth";
import { useAdminStats } from "@/features/stats/api";
import { useSamples } from "@/features/training/api";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, tour: "nav-overview", end: true },
  { to: "/managers", label: "Managers", icon: Users, tour: "nav-managers", end: false },
  { to: "/teams", label: "Teams", icon: Shield, tour: "nav-teams", end: false },
  { to: "/team-requests", label: "Team approvals", icon: ShieldCheck, tour: "nav-team-requests", end: false },
  { to: "/training", label: "Training", icon: GraduationCap, tour: "nav-training", end: false },
] as const;

const COLLAPSE_KEY = "7xen.admin.sidebar-collapsed";

function titleFor(pathname: string) {
  const item = [...NAV].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return item?.label ?? "Admin";
}

function NavItems({ collapsed, layoutId, onNavigate }: { collapsed: boolean; layoutId: string; onNavigate?: () => void }) {
  const stats = useAdminStats({ refetchInterval: 30_000 });
  const samples = useSamples();
  const badges: Record<string, number> = {
    "/team-requests": stats.data?.teamRequests.pending ?? 0,
    "/training": samples.data?.items.filter((s) => !s.verified && !s.excluded).length ?? 0,
  };
  return (
    <nav className="grid gap-1" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon, tour, end }) => {
        const link = (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            data-tour={tour}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                isActive ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                collapsed && "justify-center px-0",
              )
            }
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                {isActive && (
                  <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg bg-sidebar-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }}>
                    <span className="absolute top-1/2 left-0 h-5 w-1 -translate-x-[3px] -translate-y-1/2 rounded-full bg-primary shadow-glow" />
                  </motion.span>
                )}
                <Icon className={cn("relative size-[18px] shrink-0", isActive && "text-primary")} />
                {!collapsed && <span className="relative truncate">{label}</span>}
                {!!badges[to] && (
                  <span
                    className={cn(
                      "relative rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-bold text-primary-foreground",
                      collapsed ? "absolute top-0.5 right-0.5 min-w-[18px] text-center" : "ml-auto min-w-[20px] text-center",
                    )}
                  >
                    {badges[to]}
                  </span>
                )}
              </>
            )}
          </NavLink>
        );
        return collapsed ? (
          <Tooltip key={to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}

function SidebarFooterNote({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <div className="rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
      <div className="mb-1 font-display text-sm font-bold text-foreground">Phase 1</div>
      You create manager logins. Teams can be added by you or by managers — manager-added teams need your approval.
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg p-1 pr-2 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label="Account menu"
        >
          <TeamAvatar name={user.displayName} size="sm" />
          <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{user.displayName}</span>
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

function TopBar({ title, onMenu }: { title: ReactNode; onMenu?: () => void }) {
  const { start } = useTour();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/75 px-4 backdrop-blur-xl sm:px-6">
      {onMenu && (
        <Button variant="ghost" size="icon" onClick={onMenu} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">Admin Console</div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={String(title)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="truncate font-display text-lg leading-tight font-bold">
            {title}
          </motion.div>
        </AnimatePresence>
      </div>
      <Button variant="outline" size="sm" onClick={start} data-tour="tour-btn" className="gap-1.5">
        <Compass className="text-primary" />
        <span className="hidden sm:inline">Take a tour</span>
        <span className="sr-only sm:hidden">Take a tour</span>
      </Button>
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  const title = titleFor(location.pathname);
  useEffect(() => {
    document.title = `${title} · 7XEN Admin`;
  }, [title]);

  return (
    <div className="relative isolate flex min-h-dvh">
      <AnimatedBackground intensity="subtle" className="fixed" />

      {isDesktop && (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? 76 : 248 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          className="sticky top-0 flex h-dvh shrink-0 flex-col gap-6 overflow-hidden border-r bg-sidebar/85 p-4 backdrop-blur-xl"
        >
          <div className={cn("flex h-10 items-center", collapsed ? "justify-center" : "justify-between")}>
            <NavLink to="/" aria-label="7xen admin home" className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {collapsed ? <LogoMark /> : <Logo subtitle="Admin Console" />}
            </NavLink>
          </div>
          <NavItems collapsed={collapsed} layoutId="nav-active" />
          <div className="mt-auto grid gap-3">
            <SidebarFooterNote collapsed={collapsed} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size={collapsed ? "icon" : "sm"}
                  onClick={() => setCollapsed((c) => !c)}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  className={cn("text-muted-foreground", collapsed ? "mx-auto" : "justify-start")}
                >
                  {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                  {!collapsed && "Collapse"}
                </Button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">Expand sidebar</TooltipContent>}
            </Tooltip>
          </div>
        </motion.aside>
      )}

      {!isDesktop && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 gap-6 bg-sidebar p-4">
            <SheetHeader className="p-0">
              <SheetTitle asChild>
                <div>
                  <Logo subtitle="Admin Console" />
                </div>
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
            </SheetHeader>
            <NavItems collapsed={false} layoutId="nav-active-mobile" onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">
              <SidebarFooterNote collapsed={false} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} onMenu={isDesktop ? undefined : () => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
    </div>
  );
}

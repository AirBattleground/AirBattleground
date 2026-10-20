import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { useTour } from "@7xen/ui/tour";
import { cn } from "@7xen/ui/lib/utils";
import { UserMenu } from "@/components/shell/UserMenu";
import type { NavItem, ShellBrand, SidebarSlot, SidebarSlotState } from "@/components/shell";
import { LuxNav } from "./LuxNav";

const NOOP = () => undefined;

function TourButton({ iconOnly }: { iconOnly: boolean }) {
  const tour = useTour();
  const startTour = () => {
    if (tour.hasTour()) tour.start();
    else toast.info("There's no tour for this page yet.");
  };
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={startTour}
      data-tour="tour-btn"
      aria-label="Take a tour"
      title={iconOnly ? "Take a tour" : undefined}
      className={cn("lux-sh-tour-btn gap-2 border-primary/35 hover:border-primary/70", iconOnly ? "size-9 p-0" : "h-9")}
    >
      <Compass className="lux-sh-tour-icon size-4 text-primary" />
      {!iconOnly && <span>Take a tour</span>}
    </Button>
  );
}

function BrandLogo({ brand, homeHref, compact }: { brand: ShellBrand; homeHref: string; compact: boolean }) {
  return (
    <Link to={homeHref} aria-label={`${brand.name} home`} className="lux-sh-logo group relative flex shrink-0 items-center gap-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {compact ? (
        <img src={brand.mark} alt="" className="brand-ink h-8 w-auto" />
      ) : (
        <>
          <span className="relative block h-9">
            <img src={brand.wordmarkInk} alt="" className="brand-ink h-full w-auto dark:hidden" />
            <img src={brand.wordmark} alt="" className="brand-ink hidden h-full w-auto dark:block" />
          </span>
          <span aria-hidden className="lux-sh-serial hidden flex-col border-l pl-3 font-mono text-[9px] leading-tight tracking-[0.22em] text-muted-foreground uppercase 2xl:flex">
            <span>Scrim ops</span>
            <span className="text-primary">Unit-07</span>
          </span>
        </>
      )}
    </Link>
  );
}

interface LuxTopBarProps {
  nav: NavItem[];
  homeHref: string;
  brand: ShellBrand;
  compact: boolean;
  /** ≥1280px: the CTA slot renders expanded and the tour button shows its label. */
  wide: boolean;
  /** ≥1800px: the team chip and the account name render expanded too (below that they fold to avatars). */
  xwide: boolean;
  sidebarHeader?: SidebarSlot;
  sidebarAction?: SidebarSlot;
}

/** Sticky branded top bar: logo · primary nav · team chip · primary CTA · tour · theme · account. */
export function LuxTopBar({ nav, homeHref, brand, compact, wide, xwide, sidebarHeader, sidebarAction }: LuxTopBarProps) {
  // the nav gets first claim on width: the team chip folds to its avatar (tooltip) until there is room
  const headerSlot: SidebarSlotState = { collapsed: !xwide, close: NOOP };
  const actionSlot: SidebarSlotState = { collapsed: !wide, close: NOOP };
  return (
    <div className={cn("lux-sh-topbar relative flex items-center", compact ? "h-14 gap-2 px-4" : "h-16 gap-4 px-6 lg:px-8")}>
      <BrandLogo brand={brand} homeHref={homeHref} compact={compact} />
      {!compact && <span aria-hidden className="lux-sh-topbar-rule h-8 w-px shrink-0 bg-border" />}

      {compact ? <div className="flex-1" /> : <LuxNav nav={nav} />}

      <div className="flex shrink-0 items-center gap-2">
        {!compact && sidebarHeader && <div className={cn("lux-sh-slot lux-sh-slot-header", xwide ? "w-56" : "w-[52px]")}>{sidebarHeader(headerSlot)}</div>}
        {!compact && sidebarAction && <div className={cn("lux-sh-slot lux-sh-slot-action", wide ? "w-40" : "w-[52px]")}>{sidebarAction(actionSlot)}</div>}
        <TourButton iconOnly={compact || !wide} />
        <ThemeToggle />
        <div className={cn("lux-sh-user", !xwide && "lux-sh-user-compact")}>
          <UserMenu />
        </div>
      </div>
    </div>
  );
}

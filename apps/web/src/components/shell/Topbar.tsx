import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { LogoMark } from "@7xen/ui/components/brand/logo";
import { Button } from "@7xen/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { useTour } from "@7xen/ui/tour";
import { cn } from "@7xen/ui/lib/utils";
import { EASE } from "./Sidebar";
import type { ShellBrand } from "./types";
import { UserMenu } from "./UserMenu";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import { common } from "@/i18n/common";
import { useT } from "@/i18n/core";

/** Logo block: on desktop it spans the sidebar column (wordmark ↔ mark as the sidebar collapses). */
function Brand({ brand, homeHref, compact, collapsed, width }: { brand?: ShellBrand; homeHref: string; compact: boolean; collapsed: boolean; width?: number }) {
  const name = brand?.name ?? "AirBattleground";
  return (
    <div className={cn("flex h-full shrink-0 items-center transition-[width] duration-300", EASE, !compact && "pl-5")} style={compact ? undefined : { width }}>
      <Link to={homeHref} aria-label={`${name} home`} className="relative flex h-10 items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {brand ? (
          compact ? (
            <img src={brand.mark} alt="" className="brand-ink h-8 w-auto" />
          ) : (
            <>
              <span className={cn("block h-10 transition-opacity duration-200", collapsed ? "pointer-events-none opacity-0" : "opacity-100 delay-100")}>
                <img src={brand.wordmarkInk} alt="" className="brand-ink h-full w-auto dark:hidden" />
                <img src={brand.wordmark} alt="" className="brand-ink hidden h-full w-auto dark:block" />
              </span>
              <img
                src={brand.mark}
                alt=""
                aria-hidden
                className={cn("brand-ink absolute top-1/2 -left-1.5 h-7 w-auto -translate-y-1/2 transition-opacity duration-200", collapsed ? "opacity-100 delay-100" : "pointer-events-none opacity-0")}
              />
            </>
          )
        ) : (
          <LogoMark className="size-8" />
        )}
      </Link>
    </div>
  );
}

/**
 * Full-width header above the sidebar and the page: logo, search, then alerts / tour / theme / account.
 * Fixed and see-through, so page art (the home hero) runs up underneath it.
 */
export function Topbar({
  homeHref,
  compact,
  brand,
  collapsed,
  brandWidth,
  search,
  notifications,
}: {
  homeHref: string;
  compact: boolean;
  brand?: ShellBrand;
  collapsed: boolean;
  brandWidth?: number;
  search?: ReactNode;
  notifications?: ReactNode;
}) {
  const tour = useTour();
  const t = useT(common);
  const startTour = () => {
    if (tour.hasTour()) tour.start();
    else toast.info(t("no_tour"));
  };

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_88%,transparent),color-mix(in_oklch,var(--background)_62%,transparent))] backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className={cn("flex items-center gap-3", compact ? "h-14 pr-3 pl-4" : "h-16 pr-6")}>
        <Brand brand={brand} homeHref={homeHref} compact={compact} collapsed={collapsed} width={brandWidth} />

        <div className={cn("flex min-w-0 flex-1 items-center", !compact && "pl-6 xl:pl-10")}>{search}</div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {notifications}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={startTour} data-tour="tour-btn" aria-label={t("take_tour")} className="size-9 text-muted-foreground hover:text-primary">
                <Compass className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("take_tour")}</TooltipContent>
          </Tooltip>
          <LanguageSwitch />
          <ThemeToggle />
          <span aria-hidden className="mx-1.5 hidden h-8 w-px bg-border sm:block" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

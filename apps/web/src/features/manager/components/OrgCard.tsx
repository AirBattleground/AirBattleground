import { Link } from "react-router-dom";
import { ChevronRight, Plus, Trophy } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { useAuth } from "@/lib/auth";
import type { SidebarSlotState } from "@/components/shell/types";
import { useOrgLogo } from "../branding";

function OrgLogo({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("size-12 shrink-0 rounded-xl object-cover ring-1 ring-border", className)} />
  ) : (
    <TeamAvatar name={name} size="md" className={cn("size-12", className)} />
  );
}

const action = "flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Manager sidebar card — the organiser's twin of the player "My Team" card (same frame, same place below the nav):
 * organisation logo + name, approvals waiting, and the two create actions.
 */
export function OrgCard({ collapsed, pending }: SidebarSlotState & { pending: number }) {
  const { user } = useAuth();
  const logo = useOrgLogo().data?.url ?? null;
  const name = user?.displayName ?? "My organisation";

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/manager/scrims/new"
            data-tour="nav-new-scrim"
            aria-label="New scrim"
            className="ml-1 flex size-[44px] items-center justify-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          >
            <span className="flex size-10 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
              <Plus className="size-5" />
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          New scrim
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card/70 shadow-lg shadow-background/40 backdrop-blur-md" data-tour="org-card" aria-label="My organisation">
      <Link
        to="/manager"
        className="group flex items-center justify-between border-b px-4 py-3 outline-none transition-colors hover:bg-sidebar-accent/50 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset"
      >
        <span className="text-[15px] font-semibold">Organisation</span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <OrgLogo name={name} url={logo} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-wide uppercase">{name}</p>
            <Link to="/manager/requests" className="rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {pending > 0 ? (
                <span>
                  <span className="font-semibold text-primary">{pending}</span> {pending === 1 ? "approval" : "approvals"} waiting
                </span>
              ) : (
                "No approvals waiting"
              )}
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <Link to="/manager/scrims/new" data-tour="nav-new-scrim" className={cn(action, "border-primary/40 bg-primary/10 hover:bg-primary/20")}>
            <Plus className="size-4" /> New scrim
          </Link>
          <Link to="/manager/tournaments/new" data-tour="nav-new-tournament" className={cn(action, "hover:border-primary/40 hover:bg-primary/10")}>
            <Trophy className="size-4" /> New tournament
          </Link>
        </div>
      </div>
    </section>
  );
}

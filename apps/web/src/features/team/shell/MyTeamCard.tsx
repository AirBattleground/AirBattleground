import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { usePlayerTeam } from "@/features/player/api";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import type { SidebarSlotState } from "@/components/shell/types";

const SHOW = 4;

function TeamLogo({ name, tag, url, className }: { name: string; tag: string; url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("size-12 shrink-0 rounded-xl object-cover ring-1 ring-border", className)} />
  ) : (
    <TeamAvatar name={name} tag={tag} size="md" className={cn("size-12", className)} />
  );
}

/** Sidebar "My Team" card (below the nav): logo, name, member count + faces, and the one team action. */
export function MyTeamCard({ collapsed }: SidebarSlotState) {
  const { team, isLeader } = usePlayerSession();
  const q = usePlayerTeam({ enabled: !!team, poll: false });
  const t = q.data;

  // collapsed rail: just the logo (or a "+"), with a tooltip
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/team/my-team"
            data-tour="team-card"
            aria-label={team ? `${team.name} — my team` : "Create or join a team"}
            className="ml-1 flex size-[44px] items-center justify-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          >
            {team ? (
              <TeamLogo name={team.name} tag={team.tag} url={t?.logoUrl ?? null} className="size-10" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-xl border border-dashed border-primary/40 text-primary">
                <Plus className="size-5" />
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          {team ? `${team.name} · ${team.tag}` : "Create or join a team"}
        </TooltipContent>
      </Tooltip>
    );
  }

  const members = t?.members ?? [];
  const extra = members.length - SHOW;

  return (
    <section className="overflow-hidden rounded-xl border bg-card/70 shadow-lg shadow-background/40 backdrop-blur-md" data-tour="team-card" aria-label="My team">
      <Link
        to="/team/my-team"
        className="group flex items-center justify-between border-b px-4 py-3 outline-none transition-colors hover:bg-sidebar-accent/50 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset"
      >
        <span className="text-[15px] font-semibold">My Team</span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      <div className="p-4">
        {team ? (
          <>
            <div className="flex items-center gap-3">
              <TeamLogo name={team.name} tag={team.tag} url={t?.logoUrl ?? null} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-wide uppercase">{team.name}</p>
                <p className="text-xs text-muted-foreground">{t ? `${members.length}/${t.maxMembers} Members` : <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted align-middle" />}</p>
              </div>
            </div>
            {members.length > 0 && (
              <div className="mt-3 flex items-center -space-x-2">
                {members.slice(0, SHOW).map((m) => (
                  <PlayerAvatar key={m.id} name={m.ign ?? m.displayName} url={m.avatarUrl} size="sm" className="rounded-full ring-2 ring-sidebar" />
                ))}
                {extra > 0 && (
                  <span className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-sidebar">+{extra}</span>
                )}
              </div>
            )}
            <Link
              to="/team/my-team"
              className="mt-4 flex h-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-[13px] font-semibold outline-none transition-colors hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {isLeader ? "Manage team" : "View team"}
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">You're not in a team yet. Create one or join your friends.</p>
            <Link
              to="/team/my-team"
              className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 text-[13px] font-semibold outline-none transition-colors hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Plus className="size-4" /> Create or join a team
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

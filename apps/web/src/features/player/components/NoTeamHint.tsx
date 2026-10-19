import { Link } from "react-router-dom";
import { cn } from "@7xen/ui/lib/utils";

/** Phase 5c: quiet empty state for a team-only section when the player has no team (no big create/join panel). */
export function NoTeamHint({ icon, children, className }: { icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed px-5 py-10 text-center", className)} data-tour="no-team-hint">
      {icon && <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">{icon}</span>}
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link to="/team/my-team" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Create or join a team
      </Link>
    </div>
  );
}

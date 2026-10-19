import { Check, MailPlus, X } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { useAcceptTeamInvite, useDeclineTeamInvite, useMyTeamInvites } from "../api";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamLogo } from "./TeamLogo";

/** A player without a team: invitations from team leaders (sent by BGMI ID). Renders nothing when there are none. */
export function MyInvitesPanel() {
  const q = useMyTeamInvites();
  const accept = useAcceptTeamInvite();
  const decline = useDeclineTeamInvite();
  const items = q.data ?? [];
  if (items.length === 0) return null;
  const busy = accept.isPending || decline.isPending;

  return (
    <section className="rounded-2xl border border-primary/40 bg-card shadow-glow animate-rise" data-tour="my-invites">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold [&_svg]:size-5 [&_svg]:text-primary">
          <MailPlus /> You're invited
        </h2>
      </div>
      <ul className="divide-y">
        {items.map((i) => {
          const by = i.invitedBy.ign ?? i.invitedBy.displayName;
          const full = i.memberCount >= i.maxMembers;
          return (
            <li key={i.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <TeamLogo name={i.team.name} tag={i.team.tag} logoUrl={i.team.logoUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold uppercase">
                    {i.team.name} <span className="font-mono text-xs text-primary">[{i.team.tag}]</span>
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <PlayerAvatar name={by} url={i.invitedBy.avatarUrl} size="sm" className="size-4 rounded-md" /> Invited by {by} · {i.memberCount}/{i.maxMembers} players
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button className="flex-1 sm:flex-none" disabled={busy || full} onClick={() => accept.mutate({ id: i.id, team: i.team.name })}>
                  <Check /> {full ? "Team is full" : "Accept"}
                </Button>
                <Button variant="outline" className="flex-1 text-muted-foreground hover:text-destructive sm:flex-none" disabled={busy} onClick={() => decline.mutate({ id: i.id, team: i.team.name })}>
                  <X /> Decline
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

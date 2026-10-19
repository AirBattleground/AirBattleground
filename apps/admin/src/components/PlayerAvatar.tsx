import type { PlayerSummary } from "@7xen/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@7xen/ui/components/ui/avatar";
import { cn } from "@7xen/ui/lib/utils";

/** What we call a player in lists: their in-game name, else their Google name. */
export const playerName = (p: Pick<PlayerSummary, "ign" | "displayName">) => p.ign || p.displayName;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/** Round Google picture with initials fallback. */
export function PlayerAvatar({ player, size = "default", className }: { player: Pick<PlayerSummary, "ign" | "displayName" | "avatarUrl">; size?: "sm" | "default" | "lg"; className?: string }) {
  const name = playerName(player);
  return (
    <Avatar size={size} className={cn("ring-1 ring-border", className)}>
      {player.avatarUrl && <AvatarImage src={player.avatarUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-primary/15 font-display font-bold text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

import { useNavigate } from "react-router-dom";
import { BarChart3, ChevronDown, LogOut, Medal, Smartphone, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@7xen/ui/components/ui/dropdown-menu";
import { useAuth, usePlayerSession } from "@/lib/auth";
import { usePlayerTeam } from "@/features/player/api";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { markExplicitLogout } from "@/lib/session";
import { useT } from "@/i18n/core";
import { common } from "@/i18n/common";
import { userMenuMsg } from "@/i18n/team";

export const roleLabel = (u: SessionUser) => {
  if (u.role !== "PLAYER") return "Manager";
  const t = u.player?.team;
  return t ? `${t.role === "LEADER" ? "Leader" : "Member"} · ${t.tag}` : "Player";
};
/** roleLabel in the current language (players only; staff see English anyway). */
export function useRoleLabel() {
  const t = useT(userMenuMsg);
  return (u: SessionUser) => {
    if (u.role !== "PLAYER") return t("manager");
    const team = u.player?.team;
    return team ? `${team.role === "LEADER" ? t("leader") : t("member")} · ${team.tag}` : t("player");
  };
}
export const displayNameOf = (u: SessionUser) => (u.role === "PLAYER" ? (u.player?.ign ?? u.displayName) : u.displayName);

export function UserAvatar({ user, size = "sm" }: { user: SessionUser; size?: "sm" | "md" | "lg" }) {
  return user.role === "PLAYER" ? (
    <PlayerAvatar name={displayNameOf(user)} url={user.player?.avatarUrl} size={size} />
  ) : (
    <TeamAvatar name={user.displayName || user.username || "?"} size={size} />
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT(userMenuMsg);
  const tc = useT(common);
  const roleOf = useRoleLabel();
  // a leader's pending join requests: dot on the avatar + count next to "My team"
  const { hasTeam, isLeader } = usePlayerSession();
  const requests = usePlayerTeam({ enabled: hasTeam && isLeader }).data?.joinRequests.length ?? 0;
  if (!user) return null;
  const name = displayNameOf(user);
  const go = (to: string) => () => navigate(to);

  const signOut = async () => {
    markExplicitLogout();
    await logout();
    navigate("/login", { replace: true });
    toast.success(tc("signed_out"));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-xl border border-transparent p-1 pr-2 outline-none transition-colors hover:border-border hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-border data-[state=open]:bg-card"
        aria-label={t("account_menu", { name }) + (requests ? ` (${requests})` : "")}
        data-tour="user-menu"
      >
        <span className="relative">
          <UserAvatar user={user} />
          {requests > 0 && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
        </span>
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-sm font-semibold">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{roleOf(user)}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <UserAvatar user={user} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-bold">{name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {roleOf(user)} · {user.username ? `@${user.username}` : (user.player?.email ?? "")}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "PLAYER" && (
          <>
            <DropdownMenuItem onSelect={go("/team/profile")} className="cursor-pointer">
              <UserRound />
              {tc("my_profile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={go("/team/my-team")} className="cursor-pointer">
              <Users />
              {tc("nav_my_team")}
              {requests > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                  {requests > 99 ? "99+" : requests}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={go("/team/stats")} className="cursor-pointer">
              <BarChart3 />
              {tc("nav_stats")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={go("/team/results")} className="cursor-pointer">
              <Medal />
              {tc("nav_results")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {user.role === "MANAGER" && (
          <DropdownMenuItem onSelect={go("/manager/app")} className="cursor-pointer">
            <Smartphone />
            {t("manager_app")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer">
          <LogOut />
          {tc("sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

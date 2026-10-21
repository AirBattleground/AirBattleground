import { useBox } from "@/features/studio/box";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Smartphone, UserRound, Users } from "lucide-react";
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
import { useAuth } from "@/lib/auth";
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
  const box = useBox();
  const navigate = useNavigate();
  const t = useT(userMenuMsg);
  const tc = useT(common);
  const roleOf = useRoleLabel();
  if (!user) return null;
  const name = displayNameOf(user);

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
        aria-label={t("account_menu", { name })}
        data-tour="user-menu"
      >
        <UserAvatar user={user} />
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
            <DropdownMenuItem onSelect={() => navigate("/team/profile")} className="cursor-pointer">
              <UserRound />
              {tc("my_profile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/team/my-team")} className="cursor-pointer">
              <Users />
              {tc("nav_my_team")}
            </DropdownMenuItem>
          </>
        )}
        {user.role === "MANAGER" && (
          <DropdownMenuItem onSelect={() => navigate("/manager/app")} className="cursor-pointer">
            <Smartphone />
            {t("manager_app")}
          </DropdownMenuItem>
        )}
        {/* a Studio Box is connected with its key — there's no sign-in to leave */}
        {!box.isBox && (
          <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer">
            <LogOut />
            {tc("sign_out")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

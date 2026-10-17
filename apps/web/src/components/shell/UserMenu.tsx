import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Shield, Smartphone } from "lucide-react";
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
import { markExplicitLogout } from "@/lib/session";

export const roleLabel = (u: SessionUser) => (u.role === "TEAM" ? "Team account" : "Manager");
export const displayNameOf = (u: SessionUser) => (u.role === "TEAM" && u.team ? u.team.name : u.displayName);

export function UserAvatar({ user, size = "sm" }: { user: SessionUser; size?: "sm" | "md" | "lg" }) {
  return user.role === "TEAM" && user.team ? (
    <TeamAvatar name={user.team.name} tag={user.team.tag} size={size} />
  ) : (
    <TeamAvatar name={user.displayName || user.username} size={size} />
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const name = displayNameOf(user);

  const signOut = async () => {
    markExplicitLogout();
    await logout();
    navigate("/login", { replace: true });
    toast.success("Signed out. See you in the next drop!");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-xl border border-transparent p-1 pr-2 outline-none transition-colors hover:border-border hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-border data-[state=open]:bg-card"
        aria-label={`Account menu for ${name}`}
        data-tour="user-menu"
      >
        <UserAvatar user={user} />
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-sm font-semibold">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{roleLabel(user)}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <UserAvatar user={user} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-bold">{name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {roleLabel(user)} · @{user.username}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "TEAM" && (
          <DropdownMenuItem onSelect={() => navigate("/team/profile")} className="cursor-pointer">
            <Shield />
            Team profile
          </DropdownMenuItem>
        )}
        {user.role === "MANAGER" && (
          <DropdownMenuItem onSelect={() => navigate("/manager/app")} className="cursor-pointer">
            <Smartphone />
            Manager app
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer">
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

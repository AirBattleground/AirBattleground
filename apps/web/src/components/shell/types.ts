import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface NavItem {
  /** Stable id; the link gets `data-tour="nav-<key>"`. */
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
  /** Small count bubble (hidden when 0/undefined). */
  badge?: number;
  /** Only active on an exact path match (use for index routes like /manager). */
  end?: boolean;
  /** Short label for the mobile bottom tab bar (defaults to `label`). */
  short?: string;
  /** Phones: show in the bottom tab bar only while `badge` > 0 (e.g. "Live"); always in the sidebar. */
  mobileOnlyWithBadge?: boolean;
}

/** Image logo that replaces the default AirBattleground mark + wordmark in the sidebar and phone topbar. */
export interface ShellBrand {
  name: string;
  /** Full wordmark, light text (dark theme). */
  wordmark: string;
  /** Full wordmark, dark text (light theme). */
  wordmarkInk: string;
  /** Compact mark: collapsed sidebar rail and phone topbar. */
  mark: string;
}

/** Floating action button shown on phones (e.g. "New scrim"). */
export interface MobileAction {
  to: string;
  label: string;
  icon: LucideIcon;
  /** `data-tour` value */
  tour?: string;
}

export interface SidebarSlotState {
  /** Desktop sidebar is in icon-only mode. */
  collapsed: boolean;
  /** No-op (kept for compatibility; phones use the bottom tab bar). */
  close: () => void;
}

export type SidebarSlot = (state: SidebarSlotState) => ReactNode;

export interface WelcomeStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

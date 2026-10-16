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
}

export interface SidebarSlotState {
  /** Desktop sidebar is in icon-only mode. */
  collapsed: boolean;
  /** Close the mobile drawer (no-op on desktop). */
  close: () => void;
}

export type SidebarSlot = (state: SidebarSlotState) => ReactNode;

export interface WelcomeStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed, Clock, Crown, FileEdit, Flag, Lock, Shuffle, Sparkles, TrendingUp, UserPlus, XCircle } from "lucide-react";
import {
  type AdvancedVia,
  type GroupTeamStatus,
  type StageStatus,
  type TournamentStatus,
} from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { tShared } from "@/i18n/tournaments";

/** Small pulsing dot used for anything live. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-2", className)} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

const TOURNAMENT_META: Record<TournamentStatus, { tone: Tone; icon: ReactNode }> = {
  DRAFT: { tone: "neutral", icon: <FileEdit className="size-3.5" /> },
  REGISTRATION_OPEN: { tone: "success", icon: <UserPlus className="size-3.5" /> },
  REGISTRATION_CLOSED: { tone: "warning", icon: <Lock className="size-3.5" /> },
  LIVE: { tone: "danger", icon: <LiveDot /> },
  COMPLETED: { tone: "info", icon: <Flag className="size-3.5" /> },
  CANCELLED: { tone: "neutral", icon: <Ban className="size-3.5" /> },
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  PENDING: "Upcoming",
  DRAWN: "Groups drawn",
  LIVE: "Live",
  COMPLETED: "Completed",
};

const STAGE_META: Record<StageStatus, { tone: Tone; icon: ReactNode }> = {
  PENDING: { tone: "neutral", icon: <CircleDashed className="size-3.5" /> },
  DRAWN: { tone: "info", icon: <Shuffle className="size-3.5" /> },
  LIVE: { tone: "danger", icon: <LiveDot /> },
  COMPLETED: { tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
};

/** Tournament / stage status words in the current language (managers: English). */
export function useStatusLabels() {
  const t = useT(tShared);
  return {
    tournament: (s: TournamentStatus) => t(`ts_${s}`),
    stage: (s: StageStatus) => t(`ss_${s}`),
  };
}

export type StatusPillProps =
  | { kind?: "tournament"; status: TournamentStatus; className?: string; label?: string }
  | { kind: "stage"; status: StageStatus; className?: string; label?: string };

/** Plain-words status for a tournament (default) or a stage (`kind="stage"`). Live statuses pulse. */
export function StatusPill(props: StatusPillProps) {
  const labels = useStatusLabels();
  const meta = props.kind === "stage" ? STAGE_META[props.status] : TOURNAMENT_META[props.status];
  const label = props.label ?? (props.kind === "stage" ? labels.stage(props.status) : labels.tournament(props.status));
  return (
    <Pill tone={meta.tone} icon={meta.icon} className={props.className}>
      {label}
    </Pill>
  );
}

/** ADVANCED / WILDCARD / ELIMINATED / DQ badge for a team inside a group. ACTIVE renders nothing unless `showActive`. */
export function TeamStageBadge({
  status,
  via,
  champion,
  showActive,
  className,
}: {
  status: GroupTeamStatus;
  via?: AdvancedVia | null;
  champion?: boolean;
  showActive?: boolean;
  className?: string;
}) {
  const t = useT(tShared);
  const base = "px-2 py-px text-[10px] tracking-wider uppercase";
  if (champion)
    return (
      <Pill tone="warning" icon={<Crown className="size-3" />} className={cn(base, className)}>
        {t("badge_champion")}
      </Pill>
    );
  switch (status) {
    case "ADVANCED":
      return via === "WILDCARD" ? (
        <Pill tone="info" icon={<Sparkles className="size-3" />} className={cn(base, className)}>
          {t("badge_wildcard")}
        </Pill>
      ) : (
        <Pill tone="success" icon={<TrendingUp className="size-3" />} className={cn(base, className)}>
          {t("badge_advanced")}
        </Pill>
      );
    case "ELIMINATED":
      return (
        <Pill tone="neutral" icon={<XCircle className="size-3" />} className={cn(base, "opacity-80", className)}>
          {t("badge_out")}
        </Pill>
      );
    case "DISQUALIFIED":
      return (
        <Pill tone="danger" icon={<Ban className="size-3" />} className={cn(base, className)}>
          {t("badge_dq")}
        </Pill>
      );
    default:
      return showActive ? (
        <Pill tone="neutral" icon={<Clock className="size-3" />} className={cn(base, className)}>
          {t("badge_playing")}
        </Pill>
      ) : null;
  }
}

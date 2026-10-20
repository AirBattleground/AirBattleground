import type { ReactNode } from "react";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { RegistrationStatus } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";

/** Plain words a team captain understands at a glance (message keys). */
const TEAM_STATUS_TEXT = {
  PENDING: "st_pending",
  APPROVED: "st_approved",
  REJECTED: "st_rejected",
  CANCELLED: "st_cancelled",
} as const satisfies Record<RegistrationStatus, string>;

const META: Record<RegistrationStatus, { tone: Tone; icon: ReactNode }> = {
  PENDING: { tone: "warning", icon: <Clock className="size-3.5" /> },
  APPROVED: { tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  REJECTED: { tone: "danger", icon: <XCircle className="size-3.5" /> },
  CANCELLED: { tone: "neutral", icon: <Ban className="size-3.5" /> },
};

export function TeamStatusBadge({ status, className }: { status: RegistrationStatus; className?: string }) {
  const m = META[status];
  const t = useT(scrimUi);
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {t(TEAM_STATUS_TEXT[status])}
    </Pill>
  );
}

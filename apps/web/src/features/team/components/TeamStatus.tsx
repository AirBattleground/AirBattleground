import type { ReactNode } from "react";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { RegistrationStatus } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";

/** Plain words a team captain understands at a glance. */
const TEAM_STATUS_TEXT: Record<RegistrationStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "You're in",
  REJECTED: "Not accepted",
  CANCELLED: "Cancelled",
};

const META: Record<RegistrationStatus, { tone: Tone; icon: ReactNode }> = {
  PENDING: { tone: "warning", icon: <Clock className="size-3.5" /> },
  APPROVED: { tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  REJECTED: { tone: "danger", icon: <XCircle className="size-3.5" /> },
  CANCELLED: { tone: "neutral", icon: <Ban className="size-3.5" /> },
};

export function TeamStatusBadge({ status, className }: { status: RegistrationStatus; className?: string }) {
  const m = META[status];
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {TEAM_STATUS_TEXT[status]}
    </Pill>
  );
}

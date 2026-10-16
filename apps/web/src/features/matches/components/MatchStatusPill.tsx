import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, ListChecks, Radio } from "lucide-react";
import { MATCH_STATUS_LABELS, type MatchStatus } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";

const meta: Record<MatchStatus, { tone: Tone; icon: ReactNode }> = {
  SCHEDULED: { tone: "neutral", icon: <CalendarClock className="size-3.5" /> },
  LINEUP_REVIEW: { tone: "warning", icon: <ListChecks className="size-3.5" /> },
  LIVE: { tone: "info", icon: <Radio className="size-3.5" /> },
  RESULTS_REVIEW: { tone: "warning", icon: <ClipboardCheck className="size-3.5" /> },
  PUBLISHED: { tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
};

export function MatchStatusPill({ status, className }: { status: MatchStatus; className?: string }) {
  const m = meta[status];
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {MATCH_STATUS_LABELS[status]}
    </Pill>
  );
}

import { Archive, Pause, Radio } from "lucide-react";
import type { ScrimStatus } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";

const meta = {
  ACTIVE: { tone: "success", label: "Active", icon: <Radio className="size-3.5" /> },
  PAUSED: { tone: "warning", label: "Paused", icon: <Pause className="size-3.5" /> },
  ARCHIVED: { tone: "neutral", label: "Archived", icon: <Archive className="size-3.5" /> },
} as const;

export function ScrimStatusPill({ status, className }: { status: ScrimStatus; className?: string }) {
  const m = meta[status];
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {m.label}
    </Pill>
  );
}

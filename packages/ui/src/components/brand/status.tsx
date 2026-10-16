import type { ReactNode } from "react";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { REGISTRATION_STATUS_LABELS, type RegistrationStatus } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground border-border",
  brand: "bg-primary/10 text-primary border-primary/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-info/10 text-info border-info/30",
} as const;
export type Tone = keyof typeof tones;

/** Coloured pill. Prefer this over shadcn Badge when you need semantic tones. */
export function Pill({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const statusMeta: Record<RegistrationStatus, { tone: Tone; icon: ReactNode }> = {
  PENDING: { tone: "warning", icon: <Clock className="size-3.5" /> },
  APPROVED: { tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  REJECTED: { tone: "danger", icon: <XCircle className="size-3.5" /> },
  CANCELLED: { tone: "neutral", icon: <Ban className="size-3.5" /> },
};

/** Plain-language registration status ("Awaiting approval", "Approved", …). */
export function StatusBadge({ status, className }: { status: RegistrationStatus; className?: string }) {
  const m = statusMeta[status];
  return (
    <Pill tone={m.tone} icon={m.icon} className={className}>
      {REGISTRATION_STATUS_LABELS[status]}
    </Pill>
  );
}

/** Big unmistakable slot number, e.g. SLOT #07. */
export function SlotChip({ slot, size = "md", className }: { slot: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "h-9 min-w-12 text-base", md: "h-12 min-w-16 text-xl", lg: "h-20 min-w-28 text-4xl" }[size];
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-xl border border-primary/40 bg-gradient-to-b from-primary/25 to-primary/5 px-2 font-display font-bold leading-none text-foreground shadow-glow",
        s,
        className,
      )}
    >
      <span className="mb-0.5 text-[0.4em] font-semibold tracking-[0.25em] text-primary">SLOT</span>#{String(slot).padStart(2, "0")}
    </span>
  );
}

const gradients = [
  "from-brand-400 to-brand-700",
  "from-sky-400 to-indigo-600",
  "from-emerald-400 to-teal-700",
  "from-fuchsia-400 to-purple-700",
  "from-amber-300 to-orange-600",
  "from-rose-400 to-red-700",
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic gradient initials badge for a team (shows tag) or person. */
export function TeamAvatar({ name, tag, size = "md", className }: { name: string; tag?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const text = (tag ?? name.split(/\s+/).map((w) => w[0]).join("")).slice(0, 4).toUpperCase();
  const s = { sm: "size-8 text-[10px]", md: "size-10 text-xs", lg: "size-14 text-base" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-display font-bold text-white shadow-inner", gradients[hash(name) % gradients.length], s, className)}>
      {text}
    </span>
  );
}

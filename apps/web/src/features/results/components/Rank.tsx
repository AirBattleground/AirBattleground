import { Drumstick } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { resultsMsg } from "@/i18n/results";

/** Gold / silver / bronze styling for the top three (tokens only so light + dark both work). */
export const PODIUM: Record<number, { badge: string; row: string; label: string }> = {
  1: { badge: "border-warning/60 bg-warning/20 text-warning-foreground dark:text-warning shadow-[0_0_18px_-4px_var(--warning)]", row: "bg-warning/[0.07]", label: "Gold" },
  2: { badge: "border-muted-foreground/40 bg-muted-foreground/15 text-foreground", row: "bg-muted-foreground/[0.05]", label: "Silver" },
  3: { badge: "border-primary/50 bg-primary/15 text-primary", row: "bg-primary/[0.05]", label: "Bronze" },
};

/** Big rank number; top three get podium colours. */
export function RankBadge({ rank, size = "md", className }: { rank: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const t = useT(resultsMsg);
  const p = PODIUM[rank];
  const s = { sm: "size-8 text-sm rounded-lg", md: "size-10 text-lg rounded-xl", lg: "size-14 text-2xl rounded-2xl" }[size];
  return (
    <span
      aria-label={t("rank_n", { n: rank })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border font-display font-bold tabular-nums",
        p ? p.badge : "border-border bg-muted/60 text-muted-foreground",
        s,
        className,
      )}
    >
      {rank}
    </span>
  );
}

/** Chicken dinner (match win) marker. */
export function ChickenDinner({ count, className, showZero = false }: { count: number; className?: string; showZero?: boolean }) {
  const t = useT(resultsMsg);
  if (!count && !showZero) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-display font-bold tabular-nums", count ? "text-warning-foreground dark:text-warning" : "text-muted-foreground", className)}
      title={t.plural("dinners", count)}
    >
      <Drumstick className="size-4" aria-hidden />
      {count}
    </span>
  );
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

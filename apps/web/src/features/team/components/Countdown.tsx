import { cn } from "@7xen/ui/lib/utils";
import { pad2, remaining, shortCountdown } from "../format";
import { useNow } from "../useNow";
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";

/** Inline live countdown text, e.g. "3h 12m". Shows `doneText` once reached. */
export function Countdown({ to, doneText, className }: { to: string; doneText?: string; className?: string }) {
  const t = useT(scrimUi);
  const now = useNow(1000);
  const r = remaining(to, now);
  return <span className={cn("tabular-nums", className)}>{r.totalMs <= 0 ? (doneText ?? t("now")) : shortCountdown(r)}</span>;
}

/** Big segmented countdown for hero cards: 02 : 14 : 33 (with days when far away). */
export function CountdownBlocks({ to, className }: { to: string; className?: string }) {
  const t = useT(scrimUi);
  const now = useNow(1000);
  const r = remaining(to, now);
  if (r.totalMs <= 0) {
    return (
      <div className={cn("inline-flex items-center gap-2 rounded-xl bg-success/15 px-4 py-2 font-display text-lg font-bold text-success", className)}>
        <span className="size-2 animate-pulse rounded-full bg-success" /> {t("match_time")}
      </div>
    );
  }
  const parts: [string, number][] = r.days > 0
    ? [[t("cd_days"), r.days], [t("cd_hrs"), r.hours], [t("cd_min"), r.minutes]]
    : [[t("cd_hrs"), r.hours], [t("cd_min"), r.minutes], [t("cd_sec"), r.seconds]];
  return (
    <div className={cn("flex items-end gap-1.5", className)} aria-label={t("time_until_match")}>
      {parts.map(([label, v], i) => (
        <div key={label} className="flex items-end gap-1.5">
          {i > 0 && <span className="pb-5 font-display text-2xl font-bold text-muted-foreground">:</span>}
          <div className="flex flex-col items-center">
            <span className="min-w-14 rounded-lg border bg-background/70 px-2 py-1 text-center font-display text-3xl font-bold tabular-nums sm:text-4xl">
              {pad2(v)}
            </span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Hourglass, Users } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { tShared } from "@/i18n/tournaments";

/** Number that counts up to `value` when it appears/changes. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span className={cn("tabular-nums", className)}>{text}</motion.span>;
}

export interface RegistrationMeterProps {
  confirmed: number;
  max: number;
  waitlist?: number;
  /** "sm" for list cards, "md" for the hub */
  size?: "sm" | "md";
  /** hide the "N spots left" line */
  hideHint?: boolean;
  className?: string;
}

/** "97 / 128 teams" with an animated progress bar and the waiting-list count. */
export function RegistrationMeter({ confirmed, max, waitlist = 0, size = "md", hideHint, className }: RegistrationMeterProps) {
  const pct = max > 0 ? Math.min(100, (confirmed / max) * 100) : 0;
  const full = confirmed >= max;
  const left = Math.max(0, max - confirmed);
  const sm = size === "sm";
  const t = useT(tShared);
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <Users className={cn("self-center text-primary", sm ? "size-3.5" : "size-4")} aria-hidden />
          <CountUp value={confirmed} className={cn("font-display font-bold", sm ? "text-lg" : "text-2xl")} />
          <span className={cn("font-display font-semibold text-muted-foreground", sm ? "text-sm" : "text-base")}>{t("meter_of_teams", { max })}</span>
        </p>
        {!hideHint && (
          <span className={cn("text-right font-medium", sm ? "text-[11px]" : "text-xs", full ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
            {full ? t("meter_full") : t.plural("meter_left", left)}
          </span>
        )}
      </div>
      <div
        className={cn("relative mt-1.5 overflow-hidden rounded-full bg-muted", sm ? "h-1.5" : "h-2.5")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={confirmed}
        aria-label={t("meter_aria", { confirmed, max })}
      >
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-full", full ? "bg-warning" : "bg-gradient-to-r from-primary/70 to-primary")}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        />
        {!full && pct > 4 && (
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-primary-foreground/35 to-transparent motion-reduce:hidden"
            initial={{ left: "-10%" }}
            animate={{ left: `${pct}%` }}
            transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 2.5 }}
          />
        )}
      </div>
      {waitlist > 0 && (
        <p className={cn("mt-1.5 flex items-center gap-1 text-muted-foreground", sm ? "text-[11px]" : "text-xs")}>
          <Hourglass className="size-3" aria-hidden /> {t("meter_waitlist", { count: waitlist })}
        </p>
      )}
    </div>
  );
}

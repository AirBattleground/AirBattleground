import type { ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** Small uppercase panel label (Arena-lobby style). */
export function ZoneLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground", className)}>{children}</p>;
}

/**
 * One labelled panel of a manager page. A page is a few of these zones (context, main content, next action)
 * instead of a long stack of cards. Never nest a Zone inside another Zone.
 */
export function Zone({
  label,
  aside,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  label?: ReactNode;
  /** right side of the label row: a count, a small action */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  "data-tour"?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)} {...rest}>
      {(label || aside) && (
        <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
          {label ? <ZoneLabel>{label}</ZoneLabel> : <span />}
          {aside}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

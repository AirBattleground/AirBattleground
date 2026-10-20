import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** A labelled page zone (lobby-style panel): small uppercase label, optional right-side action, then content. */
export function Zone({ label, action, children, className, bodyClassName, ...rest }: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Omit<HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-sm sm:p-5", className)} {...rest}>
      {(label || action) && (
        <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
          {label && <h2 className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">{label}</h2>}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Key/value row for compact fact lists inside a Zone. */
export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0", className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

import { createContext, useContext, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div data-slot="page-header" className={cn("mb-6 flex animate-rise flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div data-slot="page-header-eyebrow" className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</div>}
        <h1 data-slot="page-header-title" className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p data-slot="page-header-description" className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>}
      </div>
      {actions && <div data-slot="page-header-actions" className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const statTones = {
  brand: "from-primary/25 text-primary",
  success: "from-success/25 text-success",
  warning: "from-warning/25 text-warning",
  info: "from-info/25 text-info",
};

export function StatCard({ label, value, icon, tone = "brand", hint, className, ...rest }: {
  label: ReactNode; value: ReactNode; icon?: ReactNode; hint?: ReactNode; tone?: keyof typeof statTones; className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const t = statTones[tone];
  return (
    <div data-slot="stat-card" data-tone={tone} className={cn("group relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-glow", className)} {...rest}>
      <div className={cn("pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-gradient-to-br to-transparent blur-2xl transition-opacity group-hover:opacity-150", t)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-4xl font-bold">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && <div className={cn("rounded-lg bg-muted p-2.5 [&_svg]:size-5", t.split(" ")[1])}>{icon}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div data-slot="empty-state" className={cn("flex animate-rise flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 rounded-2xl bg-primary/10 p-4 text-primary [&_svg]:size-7">{icon}</div>}
      <h3 className="font-display text-xl font-bold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Optional replacement for FullPageLoader (an app skin can swap the spinner for its own animation):
 *   <LoaderProvider value={MyLoader}>…</LoaderProvider>
 */
const LoaderCtx = createContext<ComponentType<{ label: string }> | null>(null);
export const LoaderProvider = LoaderCtx.Provider;

export function FullPageLoader({ label = "Loading…" }: { label?: string }) {
  const Custom = useContext(LoaderCtx);
  if (Custom) return <Custom label={label} />;
  return (
    <div data-slot="page-loader" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <span className="size-10 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

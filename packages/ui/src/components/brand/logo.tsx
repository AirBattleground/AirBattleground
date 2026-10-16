import { useId } from "react";
import { cn } from "@7xen/ui/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9 drop-shadow-[0_4px_14px_var(--glow)]", className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-brand-300)" />
          <stop offset="0.5" stopColor="var(--color-brand-500)" />
          <stop offset="1" stopColor="var(--color-brand-700)" />
        </linearGradient>
      </defs>
      <path d="M20 2 36 11v18L20 38 4 29V11z" fill={`url(#${id})`} />
      <path d="M20 2 36 11v18L20 38 4 29V11z" fill="none" stroke="#fff" strokeOpacity=".3" />
      <path d="M12 13h16l-9 15h-4.5l7.2-11.6H12z" fill="#fff" />
    </svg>
  );
}

/** 7XEN wordmark. `subtitle` renders a small caps line under it (e.g. "Admin Console"). */
export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-none">
        <span className="block font-display text-2xl font-bold tracking-wider">
          7<span className="text-primary">XEN</span>
        </span>
        {subtitle && <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

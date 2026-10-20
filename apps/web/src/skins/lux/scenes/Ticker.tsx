import type { ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/**
 * Marquee strip. The row is rendered twice and slides by half its width for a seamless loop.
 * Content is decorative-plus: the first copy stays readable to screen readers, the second is aria-hidden.
 */
export function Ticker({ items, className, speed = 40 }: { items: ReactNode[]; className?: string; /** seconds per loop */ speed?: number }) {
  if (items.length === 0) return null;
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="lux-sc-ticker__row font-mono">
      {items.map((it, i) => (
        <li key={i}>
          <span className="lux-sc-ticker__dot" aria-hidden />
          {it}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("lux-sc-scene lux-sc-ticker", className)}>
      <div className="lux-sc-ticker__track" style={{ animationDuration: `${speed}s` }}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

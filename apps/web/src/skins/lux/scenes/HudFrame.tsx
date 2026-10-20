import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/**
 * HUD corner brackets around any content (the wrapper itself has no surface — style the child or pass className).
 * `label` / `serial` print small stencil tags on the top-left / bottom-right brackets.
 */
export function HudFrame({
  children,
  className,
  label,
  serial,
  tone = "primary",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; label?: string; serial?: string; tone?: "primary" | "khaki" | "success" }) {
  return (
    <div className={cn("lux-sc-hud relative", `lux-sc-hud--${tone}`, className)} {...rest}>
      <span aria-hidden className="lux-sc-hud__c lux-sc-hud__c--tl" />
      <span aria-hidden className="lux-sc-hud__c lux-sc-hud__c--tr" />
      <span aria-hidden className="lux-sc-hud__c lux-sc-hud__c--bl" />
      <span aria-hidden className="lux-sc-hud__c lux-sc-hud__c--br" />
      {label && (
        <span aria-hidden className="lux-sc-hud__tag lux-sc-hud__tag--tl font-mono">
          {label}
        </span>
      )}
      {serial && (
        <span aria-hidden className="lux-sc-hud__tag lux-sc-hud__tag--br font-mono">
          {serial}
        </span>
      )}
      {children}
    </div>
  );
}

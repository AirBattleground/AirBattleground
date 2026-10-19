import { cn } from "@7xen/ui/lib/utils";
import markUrl from "../../assets/brand/airbattleground-mark.webp";
import wordmarkUrl from "../../assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "../../assets/brand/airbattleground-wordmark-ink.webp";

/** The AirBattleground logo images (AB mark; wordmark for dark / light backgrounds). */
export const BRAND_ASSETS = { name: "AirBattleground", mark: markUrl, wordmark: wordmarkUrl, wordmarkInk: wordmarkInkUrl } as const;

/** The AB mark. Painted in the brand colour by the `.brand-ink` SVG filter (#sx-brand-ink, defined in each app's index.html). */
export function LogoMark({ className }: { className?: string }) {
  return <img src={markUrl} alt="" aria-hidden="true" draggable={false} className={cn("brand-ink h-9 w-auto object-contain drop-shadow-[0_4px_14px_var(--glow)]", className)} />;
}

/** AirBattleground logo: AB mark + wordmark. `subtitle` renders a small caps line under it (e.g. "Admin Console"). */
export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-none">
        <span className="block font-display text-xl font-bold tracking-wide">
          Air<span className="text-primary">Battleground</span>
        </span>
        {subtitle && <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

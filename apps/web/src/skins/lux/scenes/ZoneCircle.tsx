import { cn } from "@7xen/ui/lib/utils";

/**
 * Battle-royale zone: the closing zone edge (blaze orange in Lux) (shrinking ring with a tinted wall) closing in on the next safe zone
 * (dashed white circle) with a pulsing centre marker. Square — size it with className.
 */
export function ZoneCircle({ className, marker = true }: { className?: string; marker?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className={cn("lux-sc-scene lux-sc-zone pointer-events-none overflow-visible", className)}>
      {/* the current play area */}
      <circle cx="100" cy="100" r="96" fill="none" stroke="var(--lux-khaki, var(--foreground))" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="2 4" />
      {/* closing blue wall */}
      <g className="lux-sc-zone__wall">
        <circle cx="100" cy="100" r="92" fill="none" stroke="var(--primary)" strokeOpacity="0.12" strokeWidth="14" />
        <circle cx="100" cy="100" r="85" fill="none" stroke="var(--primary)" strokeOpacity="0.8" strokeWidth="1.6" />
      </g>
      {/* next safe zone */}
      <circle className="lux-sc-zone__safe" cx="118" cy="88" r="44" fill="var(--foreground)" fillOpacity="0.03" stroke="var(--foreground)" strokeOpacity="0.85" strokeWidth="1.2" strokeDasharray="5 4" />
      {marker && (
        <g>
          <circle className="lux-sc-zone__ping" cx="118" cy="88" r="6" fill="none" stroke="var(--primary)" strokeWidth="1.2" />
          <circle cx="118" cy="88" r="2.6" fill="var(--primary)" />
          <path d="M118 74v6M118 96v6M104 88h6M126 88h6" stroke="var(--primary)" strokeWidth="1.2" />
        </g>
      )}
    </svg>
  );
}

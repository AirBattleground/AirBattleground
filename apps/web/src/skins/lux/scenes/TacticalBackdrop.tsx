import { cn } from "@7xen/ui/lib/utils";
import { MapGrid } from "./MapGrid";
import { TopoLines } from "./TopoLines";

/** Base "map table" layer: topo contours, map grid, vignette and scanlines. Absolute, fills its (relative) parent. */
export function TacticalBackdrop({ className, seed, grid = true, labels = true, scanlines = true }: { className?: string; seed?: number; grid?: boolean; labels?: boolean; scanlines?: boolean }) {
  return (
    <div aria-hidden className={cn("lux-sc-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      <TopoLines seed={seed} className="absolute inset-0 size-full" />
      {grid && <MapGrid labels={labels} />}
      <div className="lux-sc-backdrop__glow absolute inset-0" />
      {scanlines && <div className="lux-sc-scanlines absolute inset-0" />}
      <div className="lux-sc-backdrop__vignette absolute inset-0" />
    </div>
  );
}

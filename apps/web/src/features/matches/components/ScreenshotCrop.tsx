import { ZoomIn } from "lucide-react";
import type { ScreenshotRow } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { screenshotUrl } from "../api";

/**
 * Card geometry of the in-game team list (3×3 grid of dark cards) as fractions of a 20:9
 * screenshot — measured on the real 1600×720 samples. Used only for a visual crop next to
 * the review card; if the image isn't ~20:9 we show the whole screenshot instead.
 */
const GRID = { x0: 0.112, y0: 0.115, w: 0.236, h: 0.27, dx: 0.2425, dy: 0.286 };

interface CropSource {
  shot: ScreenshotRow;
  /** card index on the screenshot (row-major, 0..8) */
  index: number;
}

/** Where the given slot was read from: first DONE team-list screenshot that contains it. */
export function findSlotSource(shots: ScreenshotRow[], slot: number): CropSource | null {
  for (const shot of shots) {
    if (shot.kind !== "SLOT_LIST" || shot.status !== "DONE" || !shot.extraction) continue;
    const index = shot.extraction.teams.findIndex((t) => t.slot === slot);
    if (index >= 0) return { shot, index };
  }
  return null;
}

export function ScreenshotCrop({ source, onClick, className }: { source: CropSource; onClick: () => void; className?: string }) {
  const { shot, index } = source;
  const ratio = shot.width && shot.height ? shot.width / shot.height : 20 / 9;
  const cropable = Math.abs(ratio - 20 / 9) < 0.12 && index < 9;
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x0 = GRID.x0 + col * GRID.dx;
  const y0 = GRID.y0 + row * GRID.dy;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the screenshot full size"
      className={cn(
        "group relative block w-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      style={{ aspectRatio: cropable ? `${GRID.w * 20} / ${GRID.h * 9}` : "20 / 9" }}
    >
      {cropable ? (
        <img
          src={screenshotUrl(shot.id)}
          alt="What the screenshot shows for this slot"
          loading="lazy"
          className="absolute max-w-none"
          style={{ width: `${100 / GRID.w}%`, left: `${(-x0 / GRID.w) * 100}%`, top: `${(-y0 / GRID.h) * 100}%` }}
        />
      ) : (
        <img src={screenshotUrl(shot.id)} alt="Team list screenshot" loading="lazy" className="size-full object-cover" />
      )}
      <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold opacity-80 backdrop-blur transition-opacity group-hover:opacity-100">
        <ZoomIn className="size-3" /> Screenshot
      </span>
    </button>
  );
}

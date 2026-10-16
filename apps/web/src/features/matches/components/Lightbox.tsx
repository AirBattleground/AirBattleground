import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@7xen/ui/components/ui/dialog";

export interface LightboxImage {
  id: string;
  src: string;
  label: string;
}

/** Full-size screenshot viewer with ←/→ navigation. */
export function Lightbox({
  images,
  index,
  onIndexChange,
}: {
  images: LightboxImage[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
}) {
  const open = index != null && !!images[index];
  const img = open ? images[index] : null;
  const many = images.length > 1;

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndexChange(((index ?? 0) + 1) % images.length);
      if (e.key === "ArrowLeft") onIndexChange(((index ?? 0) - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, index, images.length, onIndexChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent className="max-w-[min(96vw,1400px)] gap-3 p-3 sm:max-w-[min(96vw,1400px)] sm:p-4">
        <DialogTitle className="pr-8 font-display text-lg">{img?.label}</DialogTitle>
        <DialogDescription className="sr-only">Full-size screenshot. Use the arrow keys to see the others.</DialogDescription>
        {img && (
          <div className="relative overflow-hidden rounded-lg border bg-muted">
            <img src={img.src} alt={img.label} className="mx-auto max-h-[78vh] w-auto object-contain" />
            {many && (
              <>
                <Button
                  size="icon-lg"
                  variant="secondary"
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full opacity-90 shadow-lg"
                  aria-label="Previous screenshot"
                  onClick={() => onIndexChange(((index ?? 0) - 1 + images.length) % images.length)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="icon-lg"
                  variant="secondary"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full opacity-90 shadow-lg"
                  aria-label="Next screenshot"
                  onClick={() => onIndexChange(((index ?? 0) + 1) % images.length)}
                >
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        )}
        {many && (
          <p className="text-center text-xs text-muted-foreground">
            {(index ?? 0) + 1} of {images.length}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

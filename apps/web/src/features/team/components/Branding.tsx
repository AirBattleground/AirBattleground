import { useState, type ReactNode } from "react";
import { Maximize2, User } from "lucide-react";
import type { OrganizerRef } from "@7xen/shared";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { cn } from "@7xen/ui/lib/utils";

/**
 * Organiser logos can be dark-on-transparent, so the tile is light in both themes
 * (muted in light, near-foreground in dark) with a ring to frame it.
 */
const LOGO_TILE = "shrink-0 overflow-hidden bg-muted ring-1 ring-border dark:bg-foreground/90";

/**
 * Organiser name with their logo; falls back to a person icon when there is no logo.
 * `prefix` e.g. "by". `iconClassName` styles the fallback icon to match the surrounding meta row.
 */
export function OrganizerBadge({
  manager,
  prefix,
  className,
  logoClassName,
  iconClassName = "size-3.5",
  nameClassName,
}: {
  manager: OrganizerRef;
  prefix?: ReactNode;
  className?: string;
  logoClassName?: string;
  iconClassName?: string;
  nameClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hasLogo = !!manager.logoUrl && !failed;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {hasLogo ? (
        <span className={cn(LOGO_TILE, "inline-flex size-5 items-center justify-center rounded-md", logoClassName)}>
          <img
            src={manager.logoUrl!}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-contain p-[8%]"
            onError={() => setFailed(true)}
          />
        </span>
      ) : (
        <User className={cn("shrink-0", iconClassName)} />
      )}
      {prefix && <span className="shrink-0">{prefix}</span>}
      <span className={cn("truncate", nameClassName)}>{manager.displayName}</span>
    </span>
  );
}

/** Plain poster <img> (lazy, graceful on error). Renders nothing without a usable url. */
export function PosterImage({
  url,
  title,
  className,
  onFail,
}: {
  url?: string | null;
  title: string;
  className?: string;
  onFail?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt={`${title} poster`}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        setFailed(true);
        onFail?.();
      }}
    />
  );
}

/** Full-size poster viewer. */
export function PosterDialog({ url, title, open, onOpenChange }: { url: string; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-[min(56rem,calc(100%-2rem))] sm:p-4">
        <DialogTitle className="pr-8 font-display text-lg leading-tight">{title}</DialogTitle>
        <DialogDescription className="sr-only">Poster for {title}</DialogDescription>
        <img src={url} alt={`${title} poster`} className="mx-auto max-h-[78vh] w-auto max-w-full rounded-lg object-contain sm:max-h-[85vh]" />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Clickable square poster thumbnail that opens the full poster in a dialog.
 * Renders nothing when there is no poster or the image fails to load (no empty boxes).
 * Don't place inside a <Link>/<a> — use PosterImage there instead.
 */
export function PosterThumb({ url, title, className }: { url?: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (!url || failed) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View poster for ${title}`}
        className={cn(
          "group/poster relative size-20 shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-muted ring-1 ring-border outline-none transition-shadow hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
      >
        <img
          src={url}
          alt={`${title} poster`}
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-300 group-hover/poster:scale-105"
          onError={() => setFailed(true)}
        />
        <span className="absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-md bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity group-hover/poster:opacity-100 group-focus-visible/poster:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <PosterDialog url={url} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ImagePlus, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { MAX_BRANDING_IMAGE_BYTES } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_MB = Math.round(MAX_BRANDING_IMAGE_BYTES / (1024 * 1024));

/**
 * Upload / replace / remove one branding image (org logo or a poster).
 * - aspect "logo": small square thumbnail beside the text (compact row).
 * - aspect "square": poster artwork; large preview unless `compact`.
 * `url === undefined` means "still loading" → skeleton.
 */
export function BrandingImageCard({
  title,
  description,
  url,
  aspect,
  compact = aspect === "logo",
  onUpload,
  onRemove,
  pending = false,
  noun = aspect === "logo" ? "logo" : "poster",
  className,
  tour,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  url: string | null | undefined;
  aspect: "square" | "logo";
  compact?: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  pending?: boolean;
  /** used in button labels and the confirm dialog: "logo", "poster" */
  noun?: string;
  className?: string;
  tour?: string;
  icon?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preview, setPreview] = useState(false);
  const loading = url === undefined;
  const has = !!url;

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error("That file isn't supported", { description: "Please choose a PNG, JPEG or WebP image." });
      return;
    }
    if (file.size > MAX_BRANDING_IMAGE_BYTES) {
      toast.error("That image is too big", { description: `The image must be ${MAX_MB} MB or smaller. Try exporting a smaller version.` });
      return;
    }
    onUpload(file);
  };

  const browse = () => {
    if (!pending) input.current?.click();
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!pending) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!pending) pick(e.dataTransfer.files?.[0]);
    },
  };

  const frame = (
    <div
      {...dropProps}
      className={cn(
        "relative grid aspect-square shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted transition-colors",
        compact ? "size-24 sm:size-28" : "w-full",
        !has && "border-dashed",
        dragging && "border-primary bg-primary/10 ring-[3px] ring-primary/30",
      )}
    >
      {loading ? (
        <Skeleton className="size-full rounded-none" />
      ) : has ? (
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="size-full cursor-zoom-in outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`View ${noun} full size`}
        >
          <img src={url} alt={typeof title === "string" ? title : noun} className="size-full object-contain p-1.5" draggable={false} />
        </button>
      ) : (
        <button
          type="button"
          onClick={browse}
          disabled={pending}
          className="flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ImagePlus className={compact ? "size-6" : "size-9"} />
          {!compact && (
            <>
              <span className="text-sm font-medium">Drop an image here or click to choose</span>
              <span className="text-xs">PNG, JPEG or WebP · up to {MAX_MB} MB</span>
            </>
          )}
        </button>
      )}
      {pending && (
        <div className="absolute inset-0 grid place-items-center bg-background/70">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant={has ? "outline" : "default"} onClick={browse} disabled={pending || loading}>
        {pending ? <Loader2 className="animate-spin" /> : has ? <RefreshCw /> : <Upload />}
        {pending ? "Uploading…" : has ? "Replace" : `Upload ${noun}`}
      </Button>
      {has && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmRemove(true)}
          disabled={pending}
        >
          <Trash2 /> Remove
        </Button>
      )}
    </div>
  );

  return (
    <section data-tour={tour} className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ""; // allow picking the same file again
        }}
      />
      {compact ? (
        <div className="flex items-center gap-4">
          {frame}
          <div className="min-w-0 flex-1 space-y-2">
            <Heading title={title} description={description} icon={icon} />
            {actions}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Heading title={title} description={description} icon={icon} />
          {frame}
          {actions}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove this ${noun}?`}
        description={`Teams won't see it any more. You can upload a new one any time.`}
        confirmLabel={`Remove ${noun}`}
        cancelLabel="Keep it"
        destructive
        onConfirm={onRemove}
      />
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{title}</DialogTitle>
            <DialogDescription>This is how teams see it.</DialogDescription>
          </DialogHeader>
          {url && (
            <div className="grid place-items-center overflow-hidden rounded-xl bg-muted">
              <img src={url} alt="" className="max-h-[70vh] w-full object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Heading({ title, description, icon }: { title: ReactNode; description?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 font-display text-lg leading-tight font-bold [&_svg]:size-4.5 [&_svg]:text-primary">
        {icon}
        {title}
      </h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

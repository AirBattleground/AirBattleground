import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Eye, QrCode } from "lucide-react";
import { devicePairUrl } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { useDeviceKey } from "../api";

/**
 * QR the 7XEN Stream app scans to connect (7xen://pair?host=…&key=…). Always dark-on-white so phone cameras read it
 * in both themes. `hidden` starts blurred behind a "Show QR" tap (keys shouldn't sit on screen during a screen share).
 */
export function PairQr({ deviceId, size = 168, hidden = false, className }: { deviceId: string; size?: number; hidden?: boolean; className?: string }) {
  const [revealed, setRevealed] = useState(!hidden);
  const q = useDeviceKey(revealed ? deviceId : null);

  return (
    <div
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-xl border shadow-sm", revealed ? "bg-white p-2.5" : "bg-muted", className)}
      style={{ width: size + 22, height: size + 22 }}
    >
      {!revealed ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRevealed(true);
          }}
          className="flex size-full flex-col items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <QrCode className="size-8" />
          <span className="flex items-center gap-1">
            <Eye className="size-4" /> Show QR
          </span>
        </button>
      ) : q.data ? (
        <QRCodeSVG value={devicePairUrl(window.location.origin, q.data.key)} size={size} level="M" bgColor="#ffffff" fgColor="#0a0a0a" aria-label="QR code to connect the phone" />
      ) : q.isError ? (
        <p className="m-auto text-center text-xs text-destructive">Couldn't load the key</p>
      ) : (
        <Skeleton className="size-full" />
      )}
    </div>
  );
}

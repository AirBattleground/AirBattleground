import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LiveMatchCard } from "@7xen/shared";
import { MAP_LABELS } from "@7xen/shared";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { useSetDeviceMatch, useUpcomingMatches } from "./api";

/**
 * The device's broadcast layout drawn over the live video: a transparent PNG from the server, re-fetched about once a
 * second (the LIVE timer ticks). Double-buffered so it never flickers; pauses while the tab is hidden.
 * Sized like the 16:9 player frame, the same way the server output pads the video.
 */
export function LiveOverlay({ deviceId, url, everyMs = 1000, className }: { deviceId?: string; url?: string; everyMs?: number; className?: string }) {
  const base = url ?? `/api/manager/devices/${deviceId}/overlay.png`;
  const [src, setSrc] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`${base}?t=${Date.now()}`, { credentials: "include" });
          if (res.ok) {
            const url = URL.createObjectURL(await res.blob());
            // decode before swapping so the old frame stays up until the new one is ready
            const img = new Image();
            img.src = url;
            await img.decode().catch(() => undefined);
            if (!alive) return URL.revokeObjectURL(url);
            const old = current.current;
            current.current = url;
            setSrc(url);
            if (old) setTimeout(() => URL.revokeObjectURL(old), 2_000);
          }
        } catch {
          /* network blip: keep the last frame */
        }
      }
      timer = setTimeout(() => void tick(), everyMs);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    };
  }, [base, everyMs]);

  if (!src) return null;
  return <img src={src} alt="" aria-hidden draggable={false} className={cn("pointer-events-none absolute inset-0 size-full object-contain select-none", className)} />;
}

const NONE = "__none__";

/** Which match the layout shows (team list, points table, title). "Sample data" when none. */
export function MatchPicker({ deviceId, value }: { deviceId: string; value: string | null }) {
  const q = useUpcomingMatches();
  const set = useSetDeviceMatch(deviceId);
  const items = q.data ?? [];
  const known = !value || items.some((m) => m.matchId === value);
  const groups = groupByTitle(items);

  return (
    <Select value={value ?? NONE} onValueChange={(v) => set.mutate(v === NONE ? null : v)} disabled={set.isPending}>
      <SelectTrigger className="h-10 w-full sm:w-80" aria-label="Match shown in the layout">
        {set.isPending ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Saving…
          </span>
        ) : (
          <SelectValue placeholder="Pick a match" />
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No match (sample data)</SelectItem>
        {!known && value && <SelectItem value={value}>Current match</SelectItem>}
        {groups.map(([title, ms]) => (
          <SelectGroup key={title}>
            <SelectLabel>{title}</SelectLabel>
            {ms.map((m) => (
              <SelectItem key={m.matchId} value={m.matchId}>
                {m.subtitle} · {MAP_LABELS[m.map]}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {q.isSuccess && items.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matches today or in the next 2 days.</div>}
      </SelectContent>
    </Select>
  );
}

function groupByTitle(items: LiveMatchCard[]): [string, LiveMatchCard[]][] {
  const map = new Map<string, LiveMatchCard[]>();
  for (const m of items) map.set(m.title, [...(map.get(m.title) ?? []), m]);
  return [...map.entries()];
}

const LAYOUT_PREF = "7xen.deviceLive.showLayout";

/** "Show layout" switch, remembered in this browser (on by default). */
export function useLayoutToggle(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(LAYOUT_PREF) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_PREF, on ? "1" : "0");
    } catch {
      /* private mode: just don't remember */
    }
  }, [on]);
  return [on, setOn];
}

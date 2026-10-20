import { useEffect } from "react";
import { useStreamLayout } from "@/features/broadcast/api";
import type { StudioMixer } from "./engine/mixer";

/** The organiser's broadcast layout (title bar, teams, points) as a transparent PNG over the program. */
export function useOverlayImage(mixer: StudioMixer, on: boolean, matchId: string | null) {
  const layout = useStreamLayout();
  useEffect(() => {
    if (!on || !layout.data) {
      mixer.setOverlayImage(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/manager/stream/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: layout.data!.config, matchId }),
        });
        if (!res.ok || !alive) return;
        const next = URL.createObjectURL(await res.blob());
        const img = new Image();
        img.onload = () => {
          if (!alive) return URL.revokeObjectURL(next);
          mixer.setOverlayImage(img);
          if (url) URL.revokeObjectURL(url);
          url = next;
        };
        img.src = next;
      } catch {
        /* keep the last image */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [on, layout.data, matchId, mixer]);
}

import type { ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** The YouTube video id of a live card, when the show goes out to YouTube only (phase 8c: no HLS copy on AWS). */
export function youtubeIdOf(card: object | null | undefined): string | null {
  const id = card && "youtubeVideoId" in card ? (card as { youtubeVideoId?: unknown }).youtubeVideoId : null;
  return typeof id === "string" && /^[\w-]{6,20}$/.test(id) ? id : null;
}

/** 16:9 embedded YouTube live player (privacy-enhanced domain), muted autoplay so browsers allow it. */
export function YouTubePlayer({ videoId, title, ended, endedSlot, frameClassName }: { videoId: string; title: string; ended?: boolean; endedSlot?: ReactNode; frameClassName?: string }) {
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-xl border bg-card shadow-sm", frameClassName)}>
      {ended && endedSlot ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">{endedSlot}</div>
      ) : (
        <iframe
          className="absolute inset-0 size-full"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}

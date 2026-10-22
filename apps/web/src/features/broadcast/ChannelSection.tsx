import { useMemo, useState } from "react";
import { CalendarClock, ExternalLink, Eye, Film, Play, Radio, Users, Youtube } from "lucide-react";
import type { YoutubeChannelFeed, YoutubeVideo } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { QueryError } from "@/features/team/components/QueryError";
import { useDateFormat, useLocale, useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";
import { useYoutubeChannel } from "./live";

const PAGE = 9;

function useCompact() {
  const { lang } = useLocale();
  return useMemo(() => {
    const f = new Intl.NumberFormat(lang === "hi" ? "hi-IN" : "en-IN", { notation: "compact", maximumFractionDigits: 1 });
    return (n: number) => f.format(n);
  }, [lang]);
}

/** 3723 → "1:02:03" */
function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Live page: the site YouTube channel — stats, past live streams and uploads. Hidden when no channel is connected. */
export function ChannelSection() {
  const t = useT(liveMsg);
  const q = useYoutubeChannel();
  const [playing, setPlaying] = useState<YoutubeVideo | null>(null);

  if (q.isError) return <QueryError className="mt-10" error={q.error} onRetry={() => void q.refetch()} title={t("yt_load_error")} />;
  if (q.isPending) return <ChannelSkeleton />;
  const { channel, streams, uploads } = q.data;
  if (!q.data.connected || !channel) return null;

  return (
    <section data-tour="live-channel" className="mt-12 animate-rise space-y-6">
      <ChannelHeader channel={channel} />
      <Tabs defaultValue={streams.length || !uploads.length ? "streams" : "videos"}>
        <TabsList>
          <TabsTrigger value="streams">
            <Radio /> {t("yt_tab_streams")} <span className="text-muted-foreground">{streams.length}</span>
          </TabsTrigger>
          <TabsTrigger value="videos">
            <Film /> {t("yt_tab_videos")} <span className="text-muted-foreground">{uploads.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="streams" className="mt-4">
          <VideoGrid videos={streams} onPlay={setPlaying} empty={t("yt_none_streams")} emptyDesc={t("yt_none_streams_desc")} />
        </TabsContent>
        <TabsContent value="videos" className="mt-4">
          <VideoGrid videos={uploads} onPlay={setPlaying} empty={t("yt_none_videos")} emptyDesc={t("yt_none_videos_desc")} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="gap-3 p-3 sm:max-w-4xl">
          {playing && (
            <>
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                <iframe
                  className="absolute inset-0 size-full"
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(playing.id)}?autoplay=1&playsinline=1&rel=0`}
                  title={playing.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 px-1 pb-1">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="line-clamp-2 font-display text-base leading-snug">{playing.title}</DialogTitle>
                  <DialogDescription className="text-xs">{channel.title}</DialogDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={playing.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> {t("yt_open")}
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ChannelHeader({ channel }: { channel: NonNullable<YoutubeChannelFeed["channel"]> }) {
  const t = useT(liveMsg);
  const compact = useCompact();
  const stats = [
    channel.subscribers !== null && { icon: <Users />, label: t("yt_subscribers"), value: compact(channel.subscribers) },
    { icon: <Eye />, label: t("yt_views"), value: compact(channel.views) },
    { icon: <Film />, label: t("yt_videos"), value: compact(channel.videos) },
  ].filter((s) => !!s);

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-gradient-to-br from-destructive/25 to-transparent blur-3xl" />
      <div className="absolute inset-0 bg-grid opacity-20" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {channel.thumbnailUrl ? (
            <img src={channel.thumbnailUrl} alt="" className="size-16 shrink-0 rounded-full border-2 border-destructive/60 object-cover shadow-md sm:size-20" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:size-20">
              <Youtube className="size-8" />
            </span>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Youtube className="size-4 text-destructive" /> {t("yt_heading")}
            </p>
            <h2 className="truncate font-display text-2xl font-bold sm:text-3xl">{channel.title}</h2>
            {channel.description && <p className="mt-1 line-clamp-2 max-w-xl text-sm text-muted-foreground">{channel.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {stats.map((s) => (
            <div key={s.label} className="min-w-16">
              <p className="font-display text-2xl leading-none font-bold">{s.value}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3.5">
                {s.icon} {s.label}
              </p>
            </div>
          ))}
          <Button asChild className="bg-destructive text-white hover:bg-destructive/90">
            <a href={`${channel.url}?sub_confirmation=1`} target="_blank" rel="noreferrer">
              <Youtube /> {t("yt_subscribe")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function VideoGrid({ videos, onPlay, empty, emptyDesc }: { videos: YoutubeVideo[]; onPlay: (v: YoutubeVideo) => void; empty: string; emptyDesc: string }) {
  const t = useT(liveMsg);
  const [shown, setShown] = useState(PAGE);
  if (!videos.length) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="font-display text-lg font-bold">{empty}</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyDesc}</p>
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {videos.slice(0, shown).map((v) => (
          <VideoCard key={v.id} v={v} onPlay={() => onPlay(v)} />
        ))}
      </div>
      {videos.length > shown && (
        <div className="mt-5 flex justify-center">
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            {t("yt_show_more")}
          </Button>
        </div>
      )}
    </>
  );
}

function VideoCard({ v, onPlay }: { v: YoutubeVideo; onPlay: () => void }) {
  const t = useT(liveMsg);
  const fmt = useDateFormat();
  const compact = useCompact();
  const meta = [
    v.kind === "upcoming" ? fmt(v.publishedAt, "EEE, d MMM · h:mm a") : fmt(v.publishedAt, "d MMM yyyy"),
    v.views !== null && (v.kind === "live" ? t("yt_watching_n", { n: compact(v.views) }) : t("yt_views_n", { n: compact(v.views) })),
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onPlay}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-destructive/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {v.thumbnailUrl ? (
          <img src={v.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Youtube className="size-10 text-muted-foreground" />
          </div>
        )}
        {v.kind === "live" && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-current" /> {t("yt_live")}
          </span>
        )}
        {v.kind === "upcoming" && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur-sm">
            <CalendarClock className="size-3.5" /> {t("yt_upcoming")}
          </span>
        )}
        {v.durationSec !== null && (
          <span className="absolute right-2 bottom-2 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold shadow-sm backdrop-blur-sm">
            {duration(v.durationSec)}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive text-white shadow-lg">
            <Play className="size-5 fill-current" />
          </span>
        </span>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 leading-snug font-semibold">{v.title}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
      </div>
    </button>
  );
}

function ChannelSkeleton() {
  return (
    <div className="mt-12 space-y-6">
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="aspect-video rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

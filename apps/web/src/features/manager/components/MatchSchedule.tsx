import { EyeOff, Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { addMinutesToTime, type PosterTemplate, type Scrim } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { PosterPresetPicker } from "@/features/posters/PosterPresetPicker";
import { errorMessage, useUpdateScrim } from "../api";
import { formatTime } from "../format";
import { MapChip } from "./maps";

/** "When match 1 starts · 8:00 PM" / "30 min before match 1 · 7:30 PM" */
export function registrationCloseLabel(s: Pick<Scrim, "startTime" | "registrationCloseMinutes">): string {
  const n = s.registrationCloseMinutes;
  return n > 0
    ? `${n} min before match 1 · ${formatTime(addMinutesToTime(s.startTime, -n))}`
    : `When match 1 starts · ${formatTime(s.startTime)}`;
}

/** Each match: map, start time and IDP time. */
export function MatchScheduleList({ scrim, className }: { scrim: Scrim; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)}>
      {scrim.matches.map((m) => (
        <li key={m.number} className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          <MapChip map={m.map} index={m.number - 1} />
          {m.startTime ? (
            <span className="text-muted-foreground">
              <span className="font-display font-bold text-foreground">{formatTime(m.startTime)}</span> · IDP{" "}
              {formatTime(addMinutesToTime(m.startTime, -m.idpMinutes))}
            </span>
          ) : (
            <span className="text-muted-foreground">Time not set</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function DraftPill({ className }: { className?: string }) {
  return (
    <Pill tone="neutral" icon={<EyeOff className="size-3.5" />} className={className}>
      Draft
    </Pill>
  );
}

/** Publish a draft / take a published scrim back to draft. */
export function usePublishScrim(scrim: Scrim) {
  const upd = useUpdateScrim();
  const setPublished = (published: boolean) =>
    upd.mutate(
      { id: scrim.id, input: { published } },
      {
        onSuccess: () =>
          toast.success(published ? `“${scrim.title}” is published — teams can see it now` : `“${scrim.title}” is a draft — hidden from teams`),
        onError: (e) => toast.error("Couldn't update the scrim", { description: errorMessage(e) }),
      },
    );
  return { setPublished, pending: upd.isPending };
}

/** Banner on a draft scrim's page with a one-tap publish. */
export function DraftBanner({ scrim }: { scrim: Scrim }) {
  const { setPublished, pending } = usePublishScrim(scrim);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-muted/40 p-3 text-sm">
      <EyeOff className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Draft</span> — teams, the Live page and 7XEN Studio can't see this scrim yet.
      </p>
      <Button size="sm" className="h-10" disabled={pending} onClick={() => setPublished(true)}>
        {pending ? <Loader2 className="animate-spin" /> : <Radio />} Publish now
      </Button>
    </div>
  );
}

/** The scrim's poster preset, saved on tap; shown to teams while no poster image is uploaded. */
export function ScrimPresetCard({ scrim }: { scrim: Scrim }) {
  const upd = useUpdateScrim();
  const pick = (posterTemplate: PosterTemplate) =>
    posterTemplate !== scrim.posterTemplate &&
    upd.mutate(
      { id: scrim.id, input: { posterTemplate } },
      {
        onSuccess: () => toast.success("Poster preset saved"),
        onError: (e) => toast.error("Couldn't save the preset", { description: errorMessage(e) }),
      },
    );
  return (
    <div data-tour="detail-preset" className="space-y-2">
      <div>
        <p className="text-sm font-semibold">Poster preset</p>
        <p className="text-xs text-muted-foreground">
          {scrim.posterUrl ? "Shown if you remove your poster." : "Teams see this until you upload a poster."}
        </p>
      </div>
      <PosterPresetPicker
        value={scrim.posterTemplate}
        onChange={pick}
        disabled={upd.isPending}
        data={{ title: scrim.title, maps: scrim.maps, startTime: scrim.startTime, recurrence: scrim.recurrence, organiser: scrim.manager.displayName }}
      />
    </div>
  );
}

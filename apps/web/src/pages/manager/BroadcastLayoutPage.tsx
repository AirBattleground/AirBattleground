import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ImagePlus, Loader2, Megaphone, Palette, PanelLeft, Save, Share2, Trophy, Type, Users, X } from "lucide-react";
import { DEFAULT_STREAM_LAYOUT, MAX_SPONSOR_LOGOS, deviceLiveUrl, streamLayoutSchema, type StreamLayoutConfig } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { QueryError } from "@/features/manager/components/QueryError";
import { useDevice } from "@/features/devices/api";
import { fetchPreview, useRemoveSponsor, useSaveStreamLayout, useStreamLayout, useUploadSponsor } from "@/features/broadcast/api";
import { HlsPlayer } from "@/features/station/components/HlsPlayer";

const TOUR: TourStep[] = [
  { title: "Your broadcast layout", description: "The graphics drawn over your phone's stream: title bar, team list, points table, ticker and sponsors. One layout for all your devices." },
  { element: '[data-tour="layout-preview"]', title: "Live preview", description: "Every change shows here straight away. Real match data appears once you pick a match on the device page.", side: "bottom" },
  { element: '[data-tour="layout-panels"]', title: "Turn parts on and off", description: "Panels, extras (ticker, socials, sponsors) and the look. Switch each part on or off and set its side and text.", side: "left" },
  { element: '[data-tour="layout-save"]', title: "Save", description: "Saving updates every live device view within a second.", side: "top" },
];

const ACCENTS = ["#22c7c7", "#f59e0b", "#ef4444", "#8b5cf6", "#22c55e", "#3b82f6", "#ec4899", "#f5f7fa"];

export default function BroadcastLayoutPage() {
  usePageTour("manager.broadcastLayout", TOUR);
  const [params] = useSearchParams();
  const deviceId = params.get("device");
  const q = useStreamLayout();
  const device = useDevice(deviceId ?? undefined);

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={deviceId ? `/manager/devices/${deviceId}` : "/manager/devices"}>
        <ArrowLeft /> {deviceId ? "Back to the device" : "Devices"}
      </Link>
    </Button>
  );

  return (
    <>
      {back}
      <PageHeader title="Stream layout" description="Graphics over your live stream · one layout for all devices." />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your layout" />
      ) : !q.data ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Skeleton className="aspect-video rounded-2xl" />
          <Skeleton className="h-[480px] rounded-2xl" />
        </div>
      ) : (
        <Editor initial={q.data.config} sponsors={q.data.sponsors} deviceId={deviceId} liveSrc={device.data?.videoReady ? deviceLiveUrl(device.data.id) : null} />
      )}
    </>
  );
}

function Editor({ initial, sponsors, deviceId, liveSrc }: { initial: StreamLayoutConfig; sponsors: { id: string; url: string }[]; deviceId: string | null; liveSrc: string | null }) {
  const save = useSaveStreamLayout();
  const form = useForm<StreamLayoutConfig>({ resolver: zodResolver(streamLayoutSchema), defaultValues: initial });
  const { control, handleSubmit, formState, reset, register } = form;
  const values = useWatch({ control }) as StreamLayoutConfig;

  const onSubmit = handleSubmit(async (v) => {
    const saved = await save.mutateAsync(v).catch(() => null);
    if (saved) reset(saved.config);
  });

  const [group, setGroup] = useState<"look" | "panels" | "extras">("panels");

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start">
      <div data-tour="layout-preview" className="space-y-2 xl:sticky xl:top-20">
        <Preview config={values} deviceId={deviceId} liveSrc={liveSrc} />
        <p className="text-xs text-muted-foreground">
          {liveSrc ? "Over your phone's live video" : "Over a sample background"} · {deviceId ? "uses this device's match" : "sample teams until a device has a match"}
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        <Tabs value={group} onValueChange={(v) => setGroup(v as typeof group)} data-tour="layout-panels">
          <TabsList className="grid h-10 w-full grid-cols-3">
            <TabsTrigger value="panels">Panels</TabsTrigger>
            <TabsTrigger value="extras">Extras</TabsTrigger>
            <TabsTrigger value="look">Look</TabsTrigger>
          </TabsList>

          <TabsContent value="panels" forceMount hidden={group !== "panels"} className="mt-4">
            <Group>
              <Item icon={<Type />} title="Title bar" control={control} enabledName="titleBar.enabled">
                <Field label="Title">
                  <Input placeholder="Scrim or tournament name" maxLength={60} {...register("titleBar.title")} />
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SwitchRow control={control} name="titleBar.showLogo" label="Organisation logo" />
                  <SwitchRow control={control} name="titleBar.showMatchInfo" label="Day & match number" />
                  <SwitchRow control={control} name="titleBar.showMap" label="Map name" />
                  <SwitchRow control={control} name="titleBar.showLiveTimer" label="LIVE timer" />
                </div>
              </Item>
              <Item icon={<Users />} title="Team list" control={control} enabledName="teams.enabled">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Side">
                    <SidePicker control={control} name="teams.side" />
                  </Field>
                  <Field label="Most rows">
                    <Controller control={control} name="teams.maxRows" render={({ field }) => <Range value={field.value} min={4} max={25} onChange={field.onChange} />} />
                  </Field>
                </div>
              </Item>
              <Item icon={<Trophy />} title="Points table" control={control} enabledName="points.enabled" hint="Day (scrim) or group (tournament) standings">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Side">
                    <SidePicker control={control} name="points.side" />
                  </Field>
                  <Field label="Show top">
                    <Controller control={control} name="points.topN" render={({ field }) => <Range value={field.value} min={3} max={16} onChange={field.onChange} />} />
                  </Field>
                </div>
                {values.teams?.enabled && values.points?.enabled && values.teams.side === values.points.side && (
                  <p className="text-xs text-muted-foreground">Same side as the team list — it moves to the other side.</p>
                )}
              </Item>
            </Group>
          </TabsContent>

          <TabsContent value="extras" forceMount hidden={group !== "extras"} className="mt-4">
            <Group>
              <Item icon={<Megaphone />} title="Ticker" control={control} enabledName="ticker.enabled">
                <Input placeholder="e.g. Registrations for Sunday's cup are open" maxLength={200} aria-label="Ticker text" {...register("ticker.text")} />
              </Item>
              <Item icon={<Share2 />} title="Social handles" control={control} enabledName="socials.enabled">
                <Input placeholder="e.g. YT @opusesports · IG @opus" maxLength={80} aria-label="Social handles text" {...register("socials.text")} />
              </Item>
              <Item icon={<ImagePlus />} title="Sponsors" control={control} enabledName="sponsors.enabled">
                <Field label="Corner">
                  <Controller
                    control={control}
                    name="sponsors.corner"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full sm:w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top-left">Top left</SelectItem>
                          <SelectItem value="top-right">Top right</SelectItem>
                          <SelectItem value="bottom-left">Bottom left</SelectItem>
                          <SelectItem value="bottom-right">Bottom right</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Controller control={control} name="sponsors.logoIds" render={({ field }) => <SponsorPicker sponsors={sponsors} value={field.value} onChange={field.onChange} />} />
              </Item>
            </Group>
          </TabsContent>

          <TabsContent value="look" forceMount hidden={group !== "look"} className="mt-4">
            <Group>
              <Item icon={<Palette />} title="Look">
                <Field label="Brand colour">
                  <Controller
                    control={control}
                    name="accent"
                    render={({ field }) => (
                      <div className="flex flex-wrap items-center gap-2">
                        {ACCENTS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => field.onChange(c)}
                            aria-label={`Colour ${c}`}
                            className={cn("size-9 rounded-full border-2 shadow-sm transition-transform hover:scale-110", field.value.toLowerCase() === c ? "border-foreground" : "border-transparent")}
                            style={{ background: c }}
                          />
                        ))}
                        <label className="relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border bg-muted text-xs font-bold" title="Any colour">
                          +
                          <input type="color" value={field.value} onChange={(e) => field.onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                        </label>
                      </div>
                    )}
                  />
                </Field>
                <Field label="Panel darkness">
                  <Controller control={control} name="panelOpacity" render={({ field }) => <Range value={field.value} min={30} max={100} onChange={field.onChange} suffix="%" />} />
                </Field>
              </Item>
            </Group>
          </TabsContent>
        </Tabs>

        <div data-tour="layout-save" className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <span className={cn("mr-auto text-sm", formState.isDirty ? "font-semibold text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
            {formState.isDirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => reset(DEFAULT_STREAM_LAYOUT, { keepDefaultValues: true })}>
            Reset
          </Button>
          <Button type="submit" disabled={!formState.isDirty || save.isPending} className="shadow-glow">
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save layout
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- preview

function Preview({ config, deviceId, liveSrc }: { config: StreamLayoutConfig; deviceId: string | null; liveSrc: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const json = JSON.stringify(config);

  useEffect(() => {
    const parsed = streamLayoutSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      fetchPreview(parsed.data, { deviceId }, ctrl.signal)
        .then((url) => {
          const old = current.current;
          current.current = url;
          setSrc(url);
          setError(null);
          if (old) setTimeout(() => URL.revokeObjectURL(old), 1_000);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== "AbortError") setError((e as Error).message);
        })
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [json, deviceId]);

  useEffect(() => () => void (current.current && URL.revokeObjectURL(current.current)), []);

  const overlay = src && <img src={src} alt="Layout preview" className="pointer-events-none absolute inset-0 size-full object-contain" />;
  return (
    <div className="relative">
      {liveSrc ? (
        <HlsPlayer src={liveSrc} showLiveBadge={false} label="Live preview">
          {overlay}
        </HlsPlayer>
      ) : (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-[radial-gradient(ellipse_at_30%_20%,#3d5a40_0%,#1d2b22_45%,#0b0f0c_100%)]">
          <div className="absolute inset-0 bg-grid opacity-30" />
          {overlay}
        </div>
      )}
      {(busy || error) && (
        <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-md bg-background/85 px-2 py-1 text-xs shadow-sm backdrop-blur">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {error ?? "Updating…"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bits

type Name = Parameters<Control<StreamLayoutConfig>["register"]>[0];

/** One card holding several items, separated by dividers (no cards inside cards). */
function Group({ children }: { children: ReactNode }) {
  return <section className="divide-y rounded-2xl border bg-card px-4 shadow-sm sm:px-5">{children}</section>;
}

function Item({ icon, title, hint, control, enabledName, children }: { icon: ReactNode; title: string; hint?: string; control?: Control<StreamLayoutConfig>; enabledName?: Name; children: ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex min-h-10 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight font-bold">{title}</h2>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {control && enabledName && <Controller control={control} name={enabledName} render={({ field }) => <Switch checked={!!field.value} onCheckedChange={field.onChange} aria-label={`Show ${title}`} />} />}
      </div>
      {control && enabledName ? <EnabledBody control={control} name={enabledName}>{children}</EnabledBody> : <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

function EnabledBody({ control, name, children }: { control: Control<StreamLayoutConfig>; name: Name; children: ReactNode }) {
  const on = useWatch({ control, name });
  if (!on) return null;
  return <div className="mt-4 space-y-4">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function SwitchRow({ control, name, label }: { control: Control<StreamLayoutConfig>; name: Name; label: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2 text-sm">
          {label}
          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  );
}

function SidePicker({ control, name }: { control: Control<StreamLayoutConfig>; name: "teams.side" | "points.side" }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(v) => v && field.onChange(v)} className="w-full">
          <ToggleGroupItem value="left" className="flex-1">
            <PanelLeft /> Left
          </ToggleGroupItem>
          <ToggleGroupItem value="right" className="flex-1">
            <PanelLeft className="rotate-180" /> Right
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    />
  );
}

function Range({ value, min, max, onChange, suffix = "" }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-2 flex-1 cursor-pointer accent-primary" />
      <span className="w-12 text-right font-display text-lg font-bold tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function SponsorPicker({ sponsors, value, onChange }: { sponsors: { id: string; url: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const upload = useUploadSponsor();
  const remove = useRemoveSponsor();
  const input = useRef<HTMLInputElement | null>(null);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">Logos</Label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {sponsors.map((s) => {
          const on = value.includes(s.id);
          return (
            <div key={s.id} className={cn("group relative flex aspect-[3/2] items-center justify-center rounded-lg border-2 bg-white p-2 transition-colors", on ? "border-primary" : "border-transparent opacity-50")}>
              <button type="button" onClick={() => toggle(s.id)} className="flex size-full items-center justify-center" aria-pressed={on} aria-label={on ? "Hide this logo" : "Show this logo"}>
                <img src={s.url} alt="" className="max-h-full max-w-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(value.filter((x) => x !== s.id));
                  remove.mutate(s.id);
                }}
                className="absolute -top-2 -right-2 hidden size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow group-hover:flex"
                aria-label="Delete logo"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        {sponsors.length < MAX_SPONSOR_LOGOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            className="flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
          >
            {upload.isPending ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            Add logo
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG/JPG up to 5 MB · tap to show or hide.</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // the server also adds it to the saved layout; mirror that here without losing unsaved edits
          if (f) upload.mutate(f, { onSuccess: (s) => onChange([...value, s.id]) });
          e.target.value = "";
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertTriangle, ArrowLeft, CalendarDays, Coins, Info, Layers, Loader2, Map as MapIcon, Save, Type } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  ApiError,
  createScrimSchema,
  MAX_ROOM_SLOTS,
  todayInAppTz,
  updateScrimSchema,
  type CreateScrimInput,
  type Scrim,
} from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { errorMessage, useCreateScrim, useScrim, useUpdateScrim } from "@/features/manager/api";
import { formatDate, nextOccurrences, scheduleSummary, slotRangeLabel } from "@/features/manager/format";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { MapChips } from "@/features/manager/components/maps";
import { MapsPicker } from "@/features/manager/components/MapsPicker";
import { QueryError } from "@/features/manager/components/QueryError";
import { RecurrencePicker } from "@/features/manager/components/RecurrencePicker";
import { SlotGridPreview } from "@/features/manager/components/SlotGridPreview";
import { ScrimPosterCard } from "@/features/manager/components/BrandingCards";
import { Stepper } from "@/features/manager/components/Stepper";
import { TimeSelect } from "@/features/manager/components/TimeSelect";
import { coinsLabel, WinCoinsInput } from "@/features/coins/components/WinCoinsInput";

const TOUR: TourStep[] = [
  { title: "Set up a scrim", description: "Five quick sections. Everything can be changed later." },
  { element: '[data-tour="form-basics"]', title: "Give it a name", description: "Teams see this title when they browse scrims, so keep it clear — e.g. “Evening T3 Scrims”." },
  { element: '[data-tour="form-schedule"]', title: "When does it run?", description: "One-time, every day, or weekends only. Pick the start date and time (Indian time)." },
  { element: '[data-tour="form-maps"]', title: "Matches", description: "Add one map per match, in the order you'll play them. Use the arrows to reorder." },
  { element: '[data-tour="form-slots"]', title: "Slots", description: "How many teams can join, and which slot number they start from. The grid shows exactly which slots teams get." },
  { element: '[data-tour="form-coins"]', title: "BG coins", description: "Coins the winner of each match earns. They go to the winning team's leader when you publish the results." },
  { element: '[data-tour="form-poster"]', title: "Poster", description: "Optional: upload square poster artwork. Teams see it when they browse scrims. It saves right away." },
  { element: '[data-tour="form-preview"]', title: "Check and save", description: "This preview shows the next dates it will run. Happy? Hit save." },
];

type FormIn = z.input<typeof createScrimSchema>;

function defaults(): FormIn {
  return {
    title: "",
    description: "",
    maps: ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"],
    startTime: "20:00",
    recurrence: "DAILY",
    startDate: todayInAppTz(),
    endDate: null,
    slotCount: 16,
    firstSlot: 3,
    winCoins: 0,
  };
}

function fromScrim(s: Scrim): FormIn {
  return {
    title: s.title,
    description: s.description ?? "",
    maps: s.maps,
    startTime: s.startTime,
    recurrence: s.recurrence,
    startDate: s.startDate,
    endDate: s.endDate,
    slotCount: s.slotCount,
    firstSlot: s.firstSlot,
    winCoins: s.winCoins,
  };
}

export default function ScrimFormPage() {
  const { scrimId } = useParams();
  const isEdit = !!scrimId;
  const q = useScrim(scrimId);

  if (isEdit && q.isError) {
    return (
      <>
        <BackLink to="/manager/scrims" />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this scrim" />
      </>
    );
  }
  if (isEdit && !q.data) return <FormSkeleton />;
  return <ScrimForm key={scrimId ?? "new"} scrim={isEdit ? q.data : undefined} />;
}

function BackLink({ to, label = "Back" }: { to: string; label?: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={to}>
        <ArrowLeft /> {label}
      </Link>
    </Button>
  );
}

function ScrimForm({ scrim }: { scrim?: Scrim }) {
  usePageTour("manager.scrimForm", TOUR);
  const navigate = useNavigate();
  const isEdit = !!scrim;
  const create = useCreateScrim();
  const update = useUpdateScrim();
  const [conflict, setConflict] = useState<string | null>(null);
  const today = todayInAppTz();

  const form = useForm<FormIn, unknown, CreateScrimInput>({
    resolver: zodResolver(createScrimSchema),
    defaultValues: scrim ? fromScrim(scrim) : defaults(),
    mode: "onTouched",
  });
  const { register, control, handleSubmit, watch, setValue, setError, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const recurrence = watch("recurrence");
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const startTime = watch("startTime");
  const maps = watch("maps");
  const slotCount = watch("slotCount");
  const firstSlot = watch("firstSlot") ?? 1;
  const title = watch("title");
  const winCoins = watch("winCoins");
  const noEnd = endDate == null;

  const upcoming = useMemo(
    () =>
      startDate
        ? nextOccurrences({ recurrence, startDate, endDate: recurrence === "ONCE" ? null : (endDate ?? null) }, today, 5)
        : [],
    [recurrence, startDate, endDate, today],
  );

  // Keep an existing end date valid when the start date moves past it.
  useEffect(() => {
    if (endDate && startDate && endDate < startDate) setValue("endDate", startDate, { shouldDirty: true });
  }, [startDate, endDate, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setConflict(null);
    const payload: CreateScrimInput = { ...values, endDate: values.recurrence === "ONCE" ? null : (values.endDate ?? null) };
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: scrim.id, input: updateScrimSchema.parse(payload) })
        : await create.mutateAsync(payload);
      toast.success(isEdit ? "Changes saved" : "Scrim created — teams can register now", { description: saved.title });
      navigate(`/manager/scrims/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) {
          for (const [k, msg] of Object.entries(err.fields)) setError(k as keyof FormIn, { message: msg });
        }
        if (err.code === "CONFLICT") {
          setConflict(err.message);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      }
      toast.error(isEdit ? "Couldn't save changes" : "Couldn't create the scrim", { description: errorMessage(err) });
    }
  });

  const busy = isSubmitting || create.isPending || update.isPending;
  const saveLabel = isEdit ? "Save changes" : "Create scrim";
  const maxSlotCount = MAX_ROOM_SLOTS - firstSlot + 1;
  const maxFirstSlot = MAX_ROOM_SLOTS - slotCount + 1;

  return (
    <form onSubmit={onSubmit} noValidate>
      <BackLink to={isEdit ? `/manager/scrims/${scrim.id}` : "/manager/scrims"} />
      <PageHeader
        eyebrow={isEdit ? "Edit scrim" : "New scrim"}
        title={isEdit ? scrim.title : title?.trim() || "Create a scrim"}
        description={isEdit ? "Changes apply to upcoming sessions." : "Fill in five quick sections. You can change any of it later."}
      />

      {conflict && (
        <div role="alert" className="mb-6 flex animate-rise items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">This change can't be saved</p>
            <p className="text-sm text-foreground/80">{conflict}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* (a) Basics */}
          <Section n={1} icon={<Type />} title="Basics" description="What teams will see when they browse scrims." tour="form-basics">
            <div className="grid gap-4">
              <Field label="Scrim title" htmlFor="title" error={errors.title?.message}>
                <Input id="title" placeholder="e.g. Evening T3 Scrims" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
              </Field>
              <Field label="Description" optional htmlFor="description" error={errors.description?.message} hint="Rules, eligibility, prize — anything teams should know.">
                <Textarea id="description" rows={3} placeholder="e.g. Tier 3 teams only. Be in the lobby 10 minutes before start." {...register("description")} />
              </Field>
            </div>
          </Section>

          {/* (b) Schedule */}
          <Section n={2} icon={<CalendarDays />} title="Schedule" description="How often it runs, from when, and at what time." tour="form-schedule">
            <div className="space-y-5">
              <Controller
                control={control}
                name="recurrence"
                render={({ field }) => <RecurrencePicker value={field.value} onChange={field.onChange} />}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={recurrence === "ONCE" ? "Date" : "Start date"} error={errors.startDate?.message}>
                  <Controller
                    control={control}
                    name="startDate"
                    render={({ field }) => (
                      <DatePickerButton
                        value={field.value}
                        onChange={field.onChange}
                        invalid={!!errors.startDate}
                        className="h-11 w-full"
                        isDisabled={isEdit ? undefined : (d) => d < today}
                      />
                    )}
                  />
                </Field>
                <Field label="Start time" error={errors.startTime?.message}>
                  <Controller
                    control={control}
                    name="startTime"
                    render={({ field }) => <TimeSelect value={field.value} onChange={field.onChange} invalid={!!errors.startTime} />}
                  />
                </Field>
              </div>

              {recurrence !== "ONCE" && (
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="no-end" className="font-semibold">Runs until I stop it</Label>
                      <p className="text-xs text-muted-foreground">You can pause or archive it any time.</p>
                    </div>
                    <Switch
                      id="no-end"
                      checked={noEnd}
                      onCheckedChange={(on) =>
                        setValue("endDate", on ? null : addDays(startDate || today, 30), { shouldDirty: true, shouldValidate: true })
                      }
                    />
                  </div>
                  {!noEnd && (
                    <div className="mt-4 animate-rise">
                      <Field label="Last date" error={errors.endDate?.message}>
                        <Controller
                          control={control}
                          name="endDate"
                          render={({ field }) => (
                            <DatePickerButton
                              value={field.value}
                              onChange={field.onChange}
                              invalid={!!errors.endDate}
                              className="h-11 w-full sm:w-64"
                              isDisabled={(d) => !!startDate && d < startDate}
                            />
                          )}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* (c) Matches */}
          <Section
            n={3}
            icon={<MapIcon />}
            title="Matches"
            description="One map per match, in the order you'll play them."
            tour="form-maps"
            aside={<span className="font-display text-lg font-bold text-muted-foreground">{maps.length} match{maps.length === 1 ? "" : "es"}</span>}
          >
            <Controller
              control={control}
              name="maps"
              render={({ field }) => (
                <MapsPicker value={field.value} onChange={(v) => setValue("maps", v, { shouldDirty: true, shouldValidate: true })} />
              )}
            />
            <FieldError message={errors.maps?.message ?? errors.maps?.root?.message} />
          </Section>

          {/* (d) Slots */}
          <Section n={4} icon={<Layers />} title="Slots" description="How many teams can play, and which slot numbers they get." tour="form-slots">
            <div className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Number of teams" error={errors.slotCount?.message}>
                  <Controller
                    control={control}
                    name="slotCount"
                    render={({ field }) => (
                      <div className="space-y-3">
                        <Stepper value={field.value} onChange={field.onChange} min={2} max={maxSlotCount} suffix="teams" />
                        <input
                          type="range"
                          min={2}
                          max={MAX_ROOM_SLOTS}
                          value={field.value}
                          onChange={(e) => field.onChange(Math.min(maxSlotCount, Number(e.target.value)))}
                          aria-label="Number of teams"
                          className="w-full accent-primary"
                        />
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>2</span>
                          <span>{MAX_ROOM_SLOTS}</span>
                        </div>
                      </div>
                    )}
                  />
                </Field>
                <Field
                  label="First team slot"
                  error={errors.firstSlot?.message}
                  hint="Organisers often reserve slots 1–2 for observers or casters."
                >
                  <Controller
                    control={control}
                    name="firstSlot"
                    render={({ field }) => (
                      <Stepper value={field.value ?? 1} onChange={field.onChange} min={1} max={Math.max(1, maxFirstSlot)} />
                    )}
                  />
                </Field>
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">Room preview</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Legend className="border-primary/50 bg-primary/15" label="Teams" />
                    <Legend className="border-dashed bg-muted/60" label="Reserved" />
                    <Legend className="border-dashed" label="Unused" />
                  </span>
                </div>
                <SlotGridPreview firstSlot={firstSlot} slotCount={slotCount} />
                <p className="mt-2 text-sm text-muted-foreground">
                  Teams get <span className="font-semibold text-foreground">#{firstSlot} to #{firstSlot + slotCount - 1}</span>. The first approved team gets #{firstSlot}.
                </p>
              </div>
            </div>
          </Section>

          {/* (e) Rewards */}
          <Section n={5} icon={<Coins />} title="BG coins" description="Coins the winner of each match earns. They go to the winning team's leader." tour="form-coins">
            <Field label="Coins per match win" htmlFor="winCoins" error={errors.winCoins?.message} hint="Paid when you publish a match's results. Leave at 0 for no coins.">
              <Controller
                control={control}
                name="winCoins"
                render={({ field }) => <WinCoinsInput id="winCoins" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.winCoins} />}
              />
            </Field>
          </Section>
        </div>

        {/* Live preview */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div data-tour="form-preview" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="bg-grid border-b bg-gradient-to-br from-primary/15 to-transparent p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Preview</p>
              <p className="mt-1 truncate font-display text-2xl font-bold">{title?.trim() || "Untitled scrim"}</p>
              <p className="mt-2 text-sm leading-relaxed">{scheduleSummary({ recurrence, startDate, endDate, startTime })}</p>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next dates</p>
                {upcoming.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {upcoming.map((d) => (
                      <li key={d} className="rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium">
                        {d === today ? "Today" : formatDate(d)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No upcoming dates with these settings.</p>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matches</p>
                {maps.length ? <MapChips maps={maps} numbered /> : <p className="text-sm text-muted-foreground">No matches yet</p>}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Slots</p>
                <p className="font-display text-lg font-bold">{slotRangeLabel(firstSlot, slotCount)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Each match winner gets</p>
                <p className="font-display text-lg font-bold">{coinsLabel(winCoins ?? 0)}</p>
              </div>
              {Object.keys(errors).length > 0 && (
                <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
                  <Info className="size-4 shrink-0" /> Please fix the highlighted fields.
                </p>
              )}
              <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy || (isEdit && !isDirty)}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {busy ? "Saving…" : saveLabel}
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to={isEdit ? `/manager/scrims/${scrim.id}` : "/manager/scrims"}>Cancel</Link>
              </Button>
            </div>
          </div>
          {isEdit && <ScrimPosterCard scrimId={scrim.id} url={scrim.posterUrl} className="mt-4" tour="form-poster" />}
        </aside>
      </div>
    </form>
  );
}

function Section({ n, icon, title, description, tour, aside, children }: {
  n: number;
  icon: ReactNode;
  title: string;
  description: string;
  tour: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className="animate-rise rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
          <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-primary font-display text-[11px] font-bold text-primary-foreground">
            {n}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, error, hint, optional, children }: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="font-semibold">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertTriangle className="size-3.5" /> {message}
    </p>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-3 rounded-sm border", className)} /> {label}
    </span>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

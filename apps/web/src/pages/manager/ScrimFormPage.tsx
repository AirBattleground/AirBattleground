import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Coins, EyeOff, Info, Loader2, Pencil, Radio, Save } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  addMinutesToTime,
  ApiError,
  createScrimSchema,
  DEFAULT_IDP_MINUTES,
  matchOffsets,
  MAX_REG_OPEN_DAYS_BEFORE,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { errorMessage, useCreateScrim, useScrim, useScrims, useUpdateScrim } from "@/features/manager/api";
import { formatDate, formatTime, nextOccurrences, regOpenSummary, scheduleSummary, slotRangeLabel } from "@/features/manager/format";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { MapChip } from "@/features/manager/components/maps";
import { DEFAULT_GAP, MatchPlanEditor, RegistrationClosePicker, type MatchPlanValue } from "@/features/manager/components/MatchPlanEditor";
import { QueryError } from "@/features/manager/components/QueryError";
import { RecurrencePicker } from "@/features/manager/components/RecurrencePicker";
import { SlotGridPreview } from "@/features/manager/components/SlotGridPreview";
import { ScrimPosterCard } from "@/features/manager/components/BrandingCards";
import { Stepper } from "@/features/manager/components/Stepper";
import { TimeSelect } from "@/features/manager/components/TimeSelect";
import { coinsLabel, WinCoinsInput } from "@/features/coins/components/WinCoinsInput";
import { PosterPresetPicker } from "@/features/posters/PosterPresetPicker";
import { useAuth } from "@/lib/auth";

const TOUR: TourStep[] = [
  { title: "Set up a scrim", description: "Five short steps. Everything can be changed later." },
  { element: '[data-tour="form-steps"]', title: "Your progress", description: "Basics → Schedule → Matches → Slots → Review. Finished steps can be tapped to go back." },
  { element: '[data-tour="form-basics"]', title: "Give it a name", description: "Teams see this title when they browse scrims, so keep it clear — e.g. “Evening T3 Scrims”." },
  { element: '[data-tour="form-schedule"]', title: "When does it run?", description: "One-time, every day, or weekends only. Daily and weekend scrims repeat the same matches every day." },
  { element: '[data-tour="form-maps"]', title: "Matches", description: "Pick how many matches, then a map, start time and IDP time for each (Indian time). Moving match 1 moves them all." },
  { element: '[data-tour="form-open"]', title: "Registration opens", description: "Leave it automatic, or pick the day and time registration opens. Daily and weekend scrims open separately for each day." },
  { element: '[data-tour="form-close"]', title: "Registration closes", description: "When match 1 starts, or a few minutes before so you have time to set up the lobby. After that only registered teams see the scrim." },
  { element: '[data-tour="form-slots"]', title: "Slots", description: "How many teams can join, and which slot number they start from. The grid shows exactly which slots teams get." },
  { element: '[data-tour="form-coins"]', title: "BG coins", description: "Coins the winner of each match earns. They go to the winning team's leader when you publish the results." },
  { element: '[data-tour="form-preset"]', title: "Poster preset", description: "No poster artwork? Pick a preset — teams see it with your scrim's name, maps and time. Upload your own any time and it takes over." },
  { element: '[data-tour="form-poster"]', title: "Poster", description: "Optional: upload square poster artwork. Teams see it when they browse scrims. It saves right away." },
  { element: '[data-tour="form-preview"]', title: "Check and save", description: "Everything in one place. Happy? Hit the button." },
  { element: '[data-tour="form-publish"]', title: "Publish or draft", description: "Published scrims show up for teams right away. A draft stays hidden until you publish it." },
  { element: '[data-tour="form-nav"]', title: "Back and next", description: "Move between steps here. Each step is checked before you go on." },
];

const STEPS = ["Basics", "Schedule", "Matches", "Slots", "Review"] as const;
const LAST = STEPS.length - 1;

type FormIn = z.input<typeof createScrimSchema>;
type FieldName = keyof FormIn;

/** Which fields each step validates (and where a field error sends the manager back to). */
const STEP_FIELDS: FieldName[][] = [
  ["title", "description", "posterTemplate"],
  ["recurrence", "startDate", "endDate"],
  ["maps", "startTime", "matchTimes", "idpMinutes", "registrationCloseMinutes", "regOpenTime", "regOpenDaysBefore"],
  ["slotCount", "firstSlot", "winCoins"],
  ["published"],
];
const stepOf = (f: string) => {
  const key = f.split(".")[0] as FieldName;
  const i = STEP_FIELDS.findIndex((fs) => fs.includes(key));
  return i < 0 ? LAST : i;
};

function defaults(): FormIn {
  return {
    title: "",
    description: "",
    maps: ["ERANGEL", "MIRAMAR", "RONDO"],
    startTime: "20:00",
    matchTimes: ["20:00", "20:40", "21:20"],
    idpMinutes: [DEFAULT_IDP_MINUTES, DEFAULT_IDP_MINUTES, DEFAULT_IDP_MINUTES],
    registrationCloseMinutes: 0,
    published: true,
    posterTemplate: "TOPO",
    recurrence: "DAILY",
    startDate: todayInAppTz(),
    endDate: null,
    slotCount: 16,
    firstSlot: 3,
    winCoins: 0,
    regOpenTime: null,
    regOpenDaysBefore: 0,
  };
}

function fromScrim(s: Scrim): FormIn {
  return {
    title: s.title,
    description: s.description ?? "",
    maps: s.maps,
    startTime: s.startTime,
    // older scrims only timed match 1: space the rest DEFAULT_GAP apart as a starting point
    matchTimes: s.matches.map((m, i) => m.startTime ?? addMinutesToTime(s.startTime, i * DEFAULT_GAP)),
    idpMinutes: s.matches.map((m) => m.idpMinutes),
    registrationCloseMinutes: s.registrationCloseMinutes,
    published: s.published,
    posterTemplate: s.posterTemplate,
    recurrence: s.recurrence,
    startDate: s.startDate,
    endDate: s.endDate,
    slotCount: s.slotCount,
    firstSlot: s.firstSlot,
    winCoins: s.winCoins,
    regOpenTime: s.regOpenTime,
    regOpenDaysBefore: s.regOpenDaysBefore,
  };
}

const DAYS_BEFORE = Array.from({ length: MAX_REG_OPEN_DAYS_BEFORE + 1 }, (_, n) => n);

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
  const { user } = useAuth();
  // the organiser name teams see (the org's name) — any of my scrims carries it; a first scrim falls back to my name
  const myScrims = useScrims();
  const orgName = scrim?.manager.displayName ?? myScrims.data?.[0]?.manager.displayName ?? user?.displayName;

  const form = useForm<FormIn, unknown, CreateScrimInput>({
    resolver: zodResolver(createScrimSchema),
    defaultValues: scrim ? fromScrim(scrim) : defaults(),
    mode: "onTouched",
  });
  const { register, control, handleSubmit, watch, setValue, setError, trigger, formState } = form;
  const [step, setStep] = useState(isEdit ? LAST : 0);
  const [reached, setReached] = useState(isEdit ? LAST : 0);
  const [showCoins, setShowCoins] = useState(() => (scrim?.winCoins ?? 0) > 0);
  const { errors, isSubmitting, isDirty } = formState;

  const recurrence = watch("recurrence");
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const startTime = watch("startTime");
  const maps = watch("maps");
  const matchTimes = watch("matchTimes") ?? [];
  const idpMinutes = watch("idpMinutes") ?? [];
  const closeMinutes = watch("registrationCloseMinutes") ?? 0;
  const regOpenTime = watch("regOpenTime");
  const regOpenDaysBefore = watch("regOpenDaysBefore") ?? 0;
  const regAuto = !regOpenTime;
  const published = watch("published") ?? true;
  const slotCount = watch("slotCount");
  const firstSlot = watch("firstSlot") ?? 1;
  const title = watch("title");
  const winCoins = watch("winCoins");
  const noEnd = endDate == null;

  const setPlan = (v: MatchPlanValue) => {
    const opts = { shouldDirty: true, shouldValidate: formState.isSubmitted };
    setValue("maps", v.maps, opts);
    setValue("matchTimes", v.matchTimes, opts);
    setValue("idpMinutes", v.idpMinutes, opts);
    setValue("startTime", v.matchTimes[0] ?? startTime, opts);
  };
  const timeErrors = maps.map((_, i) => errors.matchTimes?.[i]?.message);
  /** Schedule step's start time = match 1; later matches move by the same amount (gaps kept) */
  const setFirstStart = (t: string) => {
    const first = matchTimes[0] ?? startTime;
    const delta = matchOffsets([first, t])[1] ?? 0;
    const shift = delta > 720 ? delta - 1440 : delta;
    setPlan({ maps, idpMinutes, matchTimes: (matchTimes.length ? matchTimes : [first]).map((x) => addMinutesToTime(x, shift)) });
  };

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

  const onSubmit = handleSubmit(
    async (values) => {
    setConflict(null);
    const payload: CreateScrimInput = {
      ...values,
      startTime: values.matchTimes?.[0] ?? values.startTime,
      endDate: values.recurrence === "ONCE" ? null : (values.endDate ?? null),
      regOpenTime: values.regOpenTime ?? null,
      regOpenDaysBefore: values.regOpenTime ? values.regOpenDaysBefore : 0,
    };
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: scrim.id, input: updateScrimSchema.parse(payload) })
        : await create.mutateAsync(payload);
      const created = !saved.published
        ? "Saved as a draft — teams can't see it yet"
        : saved.recurrence === "ONCE" && !saved.regOpenTime
          ? "Scrim published — teams can register now"
          : "Scrim published";
      toast.success(isEdit ? "Changes saved" : created, { description: saved.title });
      navigate(`/manager/scrims/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) {
          const keys = Object.keys(err.fields);
          for (const [k, msg] of Object.entries(err.fields)) setError(k as keyof FormIn, { message: msg });
          if (keys.length) setStep(Math.min(...keys.map(stepOf)));
        }
        if (err.code === "CONFLICT") {
          setConflict(err.message);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      }
      toast.error(isEdit ? "Couldn't save changes" : "Couldn't create the scrim", { description: errorMessage(err) });
    }
    },
    // client-side errors on submit: jump to the first step that has one
    (errs) => {
      const keys = Object.keys(errs);
      if (keys.length) setStep(Math.min(...keys.map(stepOf)));
    },
  );

  const busy = isSubmitting || create.isPending || update.isPending;
  const saveLabel = isEdit ? "Save changes" : published ? "Publish scrim" : "Save draft";
  const maxSlotCount = MAX_ROOM_SLOTS - firstSlot + 1;
  const maxFirstSlot = MAX_ROOM_SLOTS - slotCount + 1;
  const cancelTo = isEdit ? `/manager/scrims/${scrim.id}` : "/manager/scrims";

  const goTo = (n: number) => {
    setStep(n);
    setReached((r) => Math.max(r, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = async () => {
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true });
    if (ok) goTo(Math.min(LAST, step + 1));
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    // Enter on an earlier step moves forward instead of creating the scrim.
    if (!isEdit && step < LAST) {
      e.preventDefault();
      void next();
      return;
    }
    void onSubmit(e);
  };

  return (
    <form onSubmit={submit} noValidate>
      <BackLink to={cancelTo} />
      <PageHeader eyebrow={isEdit ? "Edit scrim" : "New scrim"} title={isEdit ? scrim.title : title?.trim() || "Create a scrim"} />

      <div className="mx-auto max-w-3xl space-y-4">
        {conflict && (
          <div role="alert" className="flex animate-rise items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">This change can't be saved</p>
              <p className="text-sm text-foreground/80">{conflict}</p>
            </div>
          </div>
        )}

        <WizardSteps step={step} reached={isEdit ? LAST : reached} onSelect={goTo} />

        {step === 0 && (
          <Section n={1} title="Basics" tour="form-basics">
            <div className="grid gap-4">
              <Field label="Scrim title" htmlFor="title" error={errors.title?.message}>
                <Input id="title" placeholder="e.g. Evening T3 Scrims" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
              </Field>
              <Field label="Description" optional htmlFor="description" error={errors.description?.message}>
                <Textarea id="description" rows={3} placeholder="Rules, eligibility, prize — anything teams should know." {...register("description")} />
              </Field>
              <div data-tour="form-preset">
                <Field
                  label="Poster"
                  hint={isEdit ? "Teams see this preset until you upload your own poster below." : "Teams see this preset until you upload your own poster from the scrim page."}
                >
                  <Controller
                    control={control}
                    name="posterTemplate"
                    render={({ field }) => (
                      <PosterPresetPicker
                        value={field.value ?? "TOPO"}
                        onChange={field.onChange}
                        className="max-w-md"
                        data={{
                          title: title?.trim() || "Your scrim",
                          maps,
                          startTime: matchTimes[0] ?? startTime,
                          recurrence,
                          organiser: orgName,
                        }}
                      />
                    )}
                  />
                </Field>
              </div>
              {isEdit && <ScrimPosterCard scrimId={scrim.id} url={scrim.posterUrl} compact tour="form-poster" className="border-dashed shadow-none" />}
            </div>
          </Section>
        )}

        {step === 1 && (
          <Section n={2} title="Schedule" tour="form-schedule">
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
                <Field label="Start time (IST)" error={errors.startTime?.message ?? errors.matchTimes?.[0]?.message} hint={maps.length > 1 ? "Match 1 starts at this time. Later matches move with it." : undefined}>
                  <TimeSelect value={matchTimes[0] ?? startTime} onChange={setFirstStart} invalid={!!errors.startTime} />
                </Field>
              </div>

              {recurrence !== "ONCE" && (
                <div className="space-y-4 border-t pt-4">
                  <div className="flex min-h-10 items-center justify-between gap-4">
                    <Label htmlFor="no-end" className="font-semibold">Runs until I stop it</Label>
                    <Switch
                      id="no-end"
                      checked={noEnd}
                      onCheckedChange={(on) =>
                        setValue("endDate", on ? null : addDays(startDate || today, 30), { shouldDirty: true, shouldValidate: true })
                      }
                    />
                  </div>
                  {!noEnd && (
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
                  )}
                </div>
              )}
              <p className="text-sm text-muted-foreground">{scheduleSummary({ recurrence, startDate, endDate, startTime })}</p>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section
            n={3}
            title="Matches"
            description={recurrence === "ONCE" ? "Map, start time and IDP time for each match (IST)." : "Map, start time and IDP time for each match (IST) — the same every day it runs."}
            tour="form-maps"
            aside={<span className="font-display text-lg font-bold text-muted-foreground">{maps.length}</span>}
          >
            <MatchPlanEditor value={{ maps, matchTimes, idpMinutes }} onChange={setPlan} timeErrors={timeErrors} />
            <FieldError message={errors.maps?.message ?? errors.maps?.root?.message ?? errors.matchTimes?.message ?? errors.idpMinutes?.message} />

            <div data-tour="form-open" className="mt-6 space-y-4 border-t pt-5">
              <div className="flex min-h-10 items-center justify-between gap-4">
                <div>
                  <Label htmlFor="reg-auto" className="font-semibold">Open registration automatically</Label>
                  <p className="text-sm text-muted-foreground">{regOpenSummary({ recurrence, regOpenTime, regOpenDaysBefore })}</p>
                </div>
                <Switch
                  id="reg-auto"
                  checked={regAuto}
                  onCheckedChange={(on) => {
                    const first = matchTimes[0] ?? startTime;
                    setValue("regOpenTime", on ? null : first > "12:00" ? "12:00" : "00:00", { shouldDirty: true, shouldValidate: true });
                    if (on) setValue("regOpenDaysBefore", 0, { shouldDirty: true });
                  }}
                />
              </div>
              {!regAuto && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Opens on" error={errors.regOpenDaysBefore?.message}>
                    <Controller
                      control={control}
                      name="regOpenDaysBefore"
                      render={({ field }) => (
                        <Select value={String(field.value ?? 0)} onValueChange={(v) => { field.onChange(Number(v)); void trigger("regOpenTime"); }}>
                          <SelectTrigger className="h-11 w-full sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DAYS_BEFORE.map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n === 0 ? "Match day" : `${n} day${n === 1 ? "" : "s"} before`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field label="Opens at (IST)" error={errors.regOpenTime?.message}>
                    <Controller
                      control={control}
                      name="regOpenTime"
                      render={({ field }) => <TimeSelect value={field.value ?? undefined} onChange={field.onChange} invalid={!!errors.regOpenTime} />}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div data-tour="form-close" className="mt-6 space-y-3 border-t pt-5">
              <div>
                <p className="font-semibold">Registration closes</p>
                <p className="text-sm text-muted-foreground">After this only registered teams see the scrim.</p>
              </div>
              <Controller
                control={control}
                name="registrationCloseMinutes"
                render={({ field }) => (
                  <RegistrationClosePicker value={field.value ?? 0} onChange={field.onChange} firstStart={matchTimes[0] ?? startTime} />
                )}
              />
              <FieldError message={errors.registrationCloseMinutes?.message} />
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section n={4} title="Slots" tour="form-slots">
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
                      </div>
                    )}
                  />
                </Field>
                <Field label="First team slot" error={errors.firstSlot?.message}>
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
                  <span className="font-medium">
                    Teams get <span className="font-display font-bold">#{firstSlot}–#{firstSlot + slotCount - 1}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Legend className="border-primary/50 bg-primary/15" label="Teams" />
                    <Legend className="border-dashed bg-muted/60" label="Reserved" />
                    <Legend className="border-dashed" label="Unused" />
                  </span>
                </div>
                <SlotGridPreview firstSlot={firstSlot} slotCount={slotCount} />
              </div>

              <div data-tour="form-coins" className="border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowCoins((v) => !v)}
                  aria-expanded={showCoins || !!errors.winCoins}
                  className="flex min-h-10 w-full items-center justify-between gap-2 text-sm font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <Coins className="size-4 text-primary" /> BG coins per match win
                    <span className="font-normal text-muted-foreground">· {coinsLabel(winCoins ?? 0)}</span>
                  </span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", (showCoins || errors.winCoins) && "rotate-180")} />
                </button>
                {(showCoins || errors.winCoins) && (
                  <div className="mt-3 animate-rise">
                    <Field label="Coins per match win" htmlFor="winCoins" error={errors.winCoins?.message} hint="Paid to the winning team's leader when you publish. 0 = no coins.">
                      <Controller
                        control={control}
                        name="winCoins"
                        render={({ field }) => <WinCoinsInput id="winCoins" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.winCoins} />}
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </Section>
        )}

        {step === LAST && (
          <Section n={5} title={isEdit ? "Review" : "Review & create"} tour="form-preview">
            <dl className="divide-y text-sm">
              <ReviewRow label="Title" onEdit={() => goTo(0)}>
                <span className="font-display text-lg font-bold">{title?.trim() || "Untitled scrim"}</span>
              </ReviewRow>
              <ReviewRow label="Schedule" onEdit={() => goTo(1)}>
                <span>{scheduleSummary({ recurrence, startDate, endDate, startTime })}</span>
                {upcoming.length ? (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {upcoming.map((d) => (
                      <span key={d} className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                        {d === today ? "Today" : formatDate(d)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-1 block text-destructive">No upcoming dates with these settings.</span>
                )}
              </ReviewRow>
              <ReviewRow label={`Matches · ${maps.length}`} onEdit={() => goTo(2)}>
                {maps.length ? (
                  <ol className="space-y-1.5">
                    {maps.map((m, i) => {
                      const t = matchTimes[i];
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <MapChip map={m} index={i} />
                          {t && (
                            <span className="text-muted-foreground">
                              <span className="font-display font-bold text-foreground">{formatTime(t)}</span> · IDP{" "}
                              {formatTime(addMinutesToTime(t, -(idpMinutes[i] ?? DEFAULT_IDP_MINUTES)))}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <span className="text-destructive">No matches yet</span>
                )}
              </ReviewRow>
              <ReviewRow label="Registration opens" onEdit={() => goTo(2)}>
                <span>{regOpenSummary({ recurrence, regOpenTime, regOpenDaysBefore })}</span>
              </ReviewRow>
              <ReviewRow label="Registration closes" onEdit={() => goTo(2)}>
                <span>
                  {closeMinutes > 0
                    ? `${closeMinutes} min before match 1 · ${formatTime(addMinutesToTime(startTime, -closeMinutes))}`
                    : `When match 1 starts · ${formatTime(startTime)}`}
                </span>
              </ReviewRow>
              <ReviewRow label="Slots" onEdit={() => goTo(3)}>
                <span className="font-display text-base font-bold">{slotRangeLabel(firstSlot, slotCount)}</span>
              </ReviewRow>
              <ReviewRow label="Each match winner gets" onEdit={() => goTo(3)}>
                <span className="font-display text-base font-bold">{coinsLabel(winCoins ?? 0)}</span>
              </ReviewRow>
            </dl>
            <div data-tour="form-publish" className="mt-4 border-t pt-4">
              <Controller
                control={control}
                name="published"
                render={({ field }) => <PublishPicker value={field.value ?? true} onChange={field.onChange} isEdit={isEdit} />}
              />
            </div>
            {Object.keys(errors).length > 0 && (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
                <Info className="size-4 shrink-0" /> Please fix the highlighted fields.
              </p>
            )}
          </Section>
        )}

        <div data-tour="form-nav" className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-20 lg:bottom-3 flex items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
          {step > 0 ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => goTo(step - 1)}>
              <ArrowLeft /> Back
            </Button>
          ) : (
            <Button asChild variant="ghost" className="h-11">
              <Link to={cancelTo}>Cancel</Link>
            </Button>
          )}
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            Step {step + 1} of {STEPS.length}
          </span>
          {isEdit && step < LAST && (
            <Button type="submit" variant="outline" className="h-11 sm:ml-0" disabled={busy || !isDirty}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />} <span className="hidden sm:inline">Save</span>
            </Button>
          )}
          {step < LAST ? (
            <Button
              key="next"
              type="button"
              className={cn("h-11", !isEdit && "ml-auto sm:ml-0")}
              onClick={(e) => {
                // this button becomes the submit button when the last step opens — don't let the same click submit
                e.preventDefault();
                void next();
              }}
            >
              Next: {STEPS[step + 1]} <ArrowRight />
            </Button>
          ) : (
            <Button key="submit" type="submit" size="lg" className="ml-auto h-11 shadow-glow sm:ml-0" disabled={busy || (isEdit && !isDirty)}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              {busy ? "Saving…" : saveLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function WizardSteps({ step, reached, onSelect }: { step: number; reached: number; onSelect: (n: number) => void }) {
  return (
    <ol data-tour="form-steps" className="grid grid-cols-5 gap-1 rounded-xl border bg-card p-1.5 shadow-sm">
      {STEPS.map((label, i) => {
        const current = i === step;
        const done = i < step || (i <= reached && !current && i !== LAST);
        const enabled = i <= reached;
        return (
          <li key={label}>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(i)}
              aria-current={current ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${label}`}
              className={cn(
                "flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                !enabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
                  current ? "bg-primary-foreground/20" : done ? "bg-success/15 text-success" : "bg-muted",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="hidden truncate md:inline">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PublishPicker({ value, onChange, isEdit }: { value: boolean; onChange: (v: boolean) => void; isEdit: boolean }) {
  const options = [
    { on: true, icon: Radio, title: "Publish", text: isEdit ? "Teams can see it and register." : "Teams can see it and register right away." },
    { on: false, icon: EyeOff, title: "Draft", text: "Hidden from teams, the Live page and 7XEN Studio until you publish." },
  ];
  return (
    <div role="radiogroup" aria-label="Who can see this scrim" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const active = o.on === value;
        const Icon = o.icon;
        return (
          <button
            key={o.title}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.on)}
            className={cn(
              "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors",
              active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span className={cn("rounded-lg p-2", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              <Icon className="size-4" />
            </span>
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="block text-sm text-muted-foreground">{o.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
        <dd className="mt-1">{children}</dd>
      </div>
      <Button type="button" variant="ghost" size="sm" className="h-10 shrink-0 text-muted-foreground" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
    </div>
  );
}

function Section({ n, title, description, tour, aside, children }: {
  n: number;
  title: string;
  description?: string;
  tour: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className="animate-rise rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Step {n} of {STEPS.length}
          </p>
          <h2 className="font-display text-2xl font-bold leading-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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

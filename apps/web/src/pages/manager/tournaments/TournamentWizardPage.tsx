import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  FileText,
  GitBranch,
  Hourglass,
  Info,
  ListOrdered,
  Loader2,
  Plus,
  Rocket,
  Save,
  ScrollText,
  Trophy,
  Type,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  ApiError,
  createTournamentSchema,
  DEFAULT_LOBBY_SIZE,
  DEFAULT_POINTS_SYSTEM,
  DEFAULT_SCHEDULE,
  MAX_ROOM_SLOTS,
  MAX_STAGES,
  MAX_TOURNAMENT_TEAMS,
  scheduleConfigSchema,
  todayInAppTz,
  type CreateTournamentInput,
  type FormatIssue,
  type ManagerTournamentDetail,
  type ScheduleConfig,
  type StageSpec,
  type UpdateTournamentInput,
} from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate, formatTime } from "@/features/manager/format";
import { QueryError } from "@/features/manager/components/QueryError";
import { Stepper } from "@/features/manager/components/Stepper";
import { errorMessage, useCreateTournament, usePublishTournament, useTournament, useUpdateTournament } from "@/features/tournaments/manager/api";
import { fittingSchedule, groupSizes, normalizeStages, planSchedule, suggestFormat, validateFormat } from "@/features/tournaments/manager/engine";
import { formatInstant } from "@/features/tournaments/manager/format";
import { DateTimeInput } from "@/features/tournaments/manager/components/DateTimeInput";
import { Field, Section } from "@/features/tournaments/manager/components/form";
import { FormatFlow } from "@/features/tournaments/manager/components/FormatFlow";
import { FormatIssues } from "@/features/tournaments/manager/components/FormatIssues";
import { PointsPicker, pointsLabel } from "@/features/tournaments/manager/components/PointsPicker";
import { ScheduleEditor } from "@/features/tournaments/manager/components/ScheduleEditor";
import { SchedulePreview } from "@/features/tournaments/manager/components/SchedulePreview";
import { StageEditor } from "@/features/tournaments/manager/components/StageEditor";

const TOUR: TourStep[] = [
  { title: "Create a tournament", description: "Four short steps. Nothing goes live until you press Publish — you can save a draft any time." },
  { element: '[data-tour="wizard-steps"]', title: "Four steps", description: "Basics → Format → Schedule → Registration. Tap a step to jump back to it." },
  { element: '[data-tour="wizard-basics"]', title: "Name and prize", description: "What teams see first. Rules and description are optional." },
  { element: '[data-tour="wizard-presets"]', title: "Pick a size", description: "Choose a ready-made format. 7xen works out the groups and who goes through." },
  { element: '[data-tour="wizard-flow"]', title: "Live preview", description: "See how teams flow from registration to the final. It updates as you change numbers." },
  { element: '[data-tour="wizard-stages"]', title: "Fine-tune stages", description: "Open “Change …” on a stage to edit its maps, lobbies and how many go through." },
  { element: '[data-tour="wizard-schedule"]', title: "When it's played", description: "Pick the days and playing hours. Each group plays all its matches back-to-back in one lobby." },
  { element: '[data-tour="wizard-gantt"]', title: "Schedule preview", description: "Every group's time block per day and lobby. Tap a suggestion to apply it." },
  { element: '[data-tour="wizard-review"]', title: "Check everything", description: "A summary of the whole tournament before it goes live." },
  { element: '[data-tour="wizard-actions"]', title: "Save or publish", description: "Save a draft to finish later, or publish to open registration." },
];

const basicsSchema = createTournamentSchema.pick({
  title: true,
  description: true,
  rules: true,
  prize: true,
  teamSize: true,
  firstSlot: true,
  pointsSystem: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
});
type BasicsIn = z.input<typeof basicsSchema>;
type BasicsOut = z.output<typeof basicsSchema>;

const STEPS = [
  { key: "basics", label: "Basics", icon: Type },
  { key: "format", label: "Format", icon: GitBranch },
  { key: "schedule", label: "Schedule", icon: CalendarClock },
  { key: "registration", label: "Registration", icon: ClipboardList },
] as const;

const PRESETS: { key: string; teams: number | null; title: string; flow: string }[] = [
  { key: "final16", teams: 16, title: "16 teams", flow: "Final only" },
  { key: "q64", teams: 64, title: "64 teams", flow: "Qualifier → Final" },
  { key: "q128", teams: 128, title: "128 teams", flow: "Qualifier → Semi → Final" },
  { key: "custom", teams: null, title: "Custom", flow: "Your own numbers" },
];

/** A qualifier schedule that fits every group: a week from today, enough evenings, a sensible number of lobbies. */
function defaultSchedule(stage: StageSpec | undefined, startDate = addDays(todayInAppTz(), 7)): ScheduleConfig | null {
  if (!stage) return null;
  const parallelLobbies = Math.min(4, Math.max(1, Math.ceil(stage.groupCount / 3)));
  return fittingSchedule(stage, startDate, { ...DEFAULT_SCHEDULE, parallelLobbies });
}

/** Suggested stages for a size; the qualifier keeps `schedule` (or gets a fitting default when `schedule` is "auto"). */
function buildFormat(total: number, lobby: number, schedule: ScheduleConfig | null | "auto"): StageSpec[] {
  const next = normalizeStages(
    suggestFormat(total, lobby).map((s): StageSpec => ({ ...s, schedule: null })),
    total,
  );
  if (next[0]) next[0].schedule = schedule === "auto" ? defaultSchedule(next[0]) : schedule;
  return next;
}

function toSpec(s: ManagerTournamentDetail["stages"][number]): StageSpec {
  return {
    name: s.name,
    teamsIn: s.teamsIn,
    lobbySize: s.lobbySize,
    groupCount: s.groupCount,
    matchesPerGroup: s.matchesPerGroup,
    maps: s.maps,
    advancePerGroup: s.advancePerGroup,
    wildcardCount: s.wildcardCount,
    invitedSlots: s.invitedSlots,
    schedule: s.schedule,
  };
}

export default function TournamentWizardPage() {
  const { tournamentId } = useParams();
  const q = useTournament(tournamentId);
  if (tournamentId && q.isError)
    return (
      <>
        <BackLink to="/manager/tournaments" />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this tournament" />
      </>
    );
  if (tournamentId && !q.data) return <WizardSkeleton />;
  return <Wizard key={tournamentId ?? "new"} existing={tournamentId ? q.data : undefined} />;
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

function Wizard({ existing }: { existing?: ManagerTournamentDetail }) {
  usePageTour("manager.tournamentWizard", TOUR);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateTournament();
  const update = useUpdateTournament(existing?.id ?? "");
  const publish = usePublishTournament();

  const isEdit = !!existing;
  const formatLocked = isEdit && !existing.canEditFormat;
  const initialStep = Math.min(3, Math.max(0, Number(params.get("step") ?? 0) || 0));
  const [step, setStep] = useState(initialStep);
  const [dir, setDir] = useState(1);

  // ----- format state (kept outside the form; validated with the shared schema on save) -----
  const [maxTeams, setMaxTeams] = useState(existing?.maxTeams ?? 64);
  const [lobby, setLobby] = useState(existing?.stages[0]?.lobbySize ?? DEFAULT_LOBBY_SIZE);
  const [preset, setPreset] = useState(existing ? "custom" : "q64");
  const [stages, setStages] = useState<StageSpec[]>(() => (existing ? existing.stages.map(toSpec) : buildFormat(64, DEFAULT_LOBBY_SIZE, "auto")));
  const schedule = stages[0]?.schedule ?? null;
  // until the organiser edits the schedule themselves, keep it sized to fit the chosen format
  const [scheduleTouched, setScheduleTouched] = useState(isEdit);
  const formatSchedule = (): ScheduleConfig | null | "auto" =>
    scheduleTouched || !schedule ? schedule : "auto";

  // ----- basics + registration (react-hook-form + shared schema) -----
  const form = useForm<BasicsIn, unknown, BasicsOut>({
    resolver: zodResolver(basicsSchema),
    mode: "onTouched",
    defaultValues: existing
      ? {
          title: existing.title,
          description: existing.description ?? "",
          rules: existing.rules ?? "",
          prize: existing.prize ?? "",
          teamSize: existing.teamSize,
          firstSlot: existing.firstSlot,
          pointsSystem: existing.pointsSystem,
          registrationOpensAt: existing.registrationOpensAt ?? undefined,
          registrationClosesAt: existing.registrationClosesAt ?? undefined,
        }
      : { title: "", description: "", rules: "", prize: "", teamSize: 4, firstSlot: 3, pointsSystem: DEFAULT_POINTS_SYSTEM },
  });
  const { register, control, watch, trigger, getValues, setError, formState } = form;
  const { errors } = formState;
  const title = watch("title");
  const prize = watch("prize");
  const firstSlot = watch("firstSlot") ?? 1;
  const pointsSystem = watch("pointsSystem") ?? DEFAULT_POINTS_SYSTEM;
  const opensAt = watch("registrationOpensAt");
  const closesAt = watch("registrationClosesAt");

  // ----- derived -----
  const issues = useMemo<FormatIssue[]>(() => {
    const list = validateFormat(stages, maxTeams);
    const biggest = Math.max(...stages.map((s) => Math.max(...groupSizes(s.teamsIn, s.groupCount))));
    if (firstSlot + biggest - 1 > MAX_ROOM_SLOTS)
      list.push({ stage: null, level: "error", message: `Slots would run from #${firstSlot} to #${firstSlot + biggest - 1}, but a room only has ${MAX_ROOM_SLOTS}. Lower the first slot (Basics) or the lobby size.` });
    return list;
  }, [stages, maxTeams, firstSlot]);
  const errorsCount = issues.filter((i) => i.level === "error").length;
  const plan = useMemo(() => (stages[0] ? planSchedule(schedule, stages[0]) : null), [schedule, stages]);
  const scheduleCheck = schedule ? scheduleConfigSchema.safeParse(schedule) : null;
  const scheduleErrors = useMemo(() => {
    if (!scheduleCheck || scheduleCheck.success) return undefined;
    const out: { startDate?: string; endDate?: string; windows?: string } = {};
    for (const i of scheduleCheck.error.issues) {
      const k = i.path[0];
      if (k === "startDate" || k === "endDate") out[k] ??= i.message;
      else if (k === "windows") out.windows ??= i.message;
    }
    return out;
  }, [scheduleCheck]);
  const scheduleOk = !!scheduleCheck?.success && !!plan && plan.unscheduledGroups.length === 0;

  const publishBlockers: string[] = [];
  if (errorsCount) publishBlockers.push(`Fix ${errorsCount === 1 ? "the format problem" : `${errorsCount} format problems`} in step 2.`);
  if (!schedule || (scheduleCheck && !scheduleCheck.success)) publishBlockers.push("Set the qualifier schedule in step 3.");
  else if (plan && plan.unscheduledGroups.length) publishBlockers.push("Some groups don't fit in the schedule (step 3).");

  // ----- format ops -----
  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p?.teams) return;
    setMaxTeams(p.teams);
    setStages(buildFormat(p.teams, lobby, formatSchedule()));
  };
  const changeTotal = (n: number) => {
    setMaxTeams(n);
    setPreset(PRESETS.find((p) => p.teams === n)?.key ?? "custom");
    setStages(buildFormat(n, lobby, formatSchedule()));
  };
  const changeLobby = (n: number) => {
    setLobby(n);
    setStages(buildFormat(maxTeams, n, formatSchedule()));
  };
  const updateStage = (i: number, patch: Partial<StageSpec>) => setStages((list) => normalizeStages(list.map((s, j) => (j === i ? { ...s, ...patch } : s)), maxTeams));
  const addStage = () =>
    setStages((list) => {
      const at = Math.max(0, list.length - 1);
      const base = list[Math.max(0, at - 1)] ?? list[0]!;
      const extra: StageSpec = { ...base, name: `Round ${at + 1}`, invitedSlots: 0, wildcardCount: 0, schedule: null };
      return normalizeStages([...list.slice(0, at), extra, ...list.slice(at)], maxTeams);
    });
  const removeStage = (i: number) => setStages((list) => normalizeStages(list.filter((_, j) => j !== i), maxTeams));
  const setSchedule = (cfg: ScheduleConfig) => {
    setScheduleTouched(true);
    setStages((list) => list.map((s, j) => (j === 0 ? { ...s, schedule: cfg } : s)));
  };

  // ----- navigation -----
  const go = async (to: number) => {
    if (to > step && step === 0) {
      const ok = await trigger(["title", "prize", "description", "rules", "teamSize", "firstSlot", "pointsSystem"]);
      if (!ok) return;
    }
    setDir(to > step ? 1 : -1);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ----- save -----
  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const save = async (andPublish: boolean) => {
    if (!(await trigger())) {
      setStep(0);
      toast.error("Please check the highlighted fields");
      return;
    }
    const basics = basicsSchema.parse(getValues());
    const parsed = createTournamentSchema.safeParse({ ...basics, maxTeams, stages });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path ?? [];
      setStep(path[0] === "stages" ? (path[2] === "schedule" ? 2 : 1) : path[0] === "registrationOpensAt" || path[0] === "registrationClosesAt" ? 3 : 0);
      toast.error("Something needs fixing", { description: first ? `${path.join(" › ")}: ${first.message}` : undefined });
      return;
    }
    setSaving(andPublish ? "publish" : "draft");
    try {
      let saved: ManagerTournamentDetail;
      if (existing) {
        const input: UpdateTournamentInput = formatLocked ? { ...basics } : parsed.data;
        saved = await update.mutateAsync(input);
      } else {
        saved = await create.mutateAsync(parsed.data satisfies CreateTournamentInput);
      }
      if (andPublish && saved.status === "DRAFT") {
        try {
          saved = await publish.mutateAsync(saved.id);
          toast.success("Published — registration is open", { description: saved.title });
        } catch (err) {
          toast.error("Saved as a draft, but couldn't publish yet", { description: errorMessage(err) });
        }
      } else {
        toast.success(existing ? "Changes saved" : "Draft saved", { description: saved.title });
      }
      navigate(`/manager/tournaments/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [k, msg] of Object.entries(err.fields)) if (k in basicsSchema.shape) setError(k as keyof BasicsIn, { message: msg });
        if (Object.keys(err.fields).some((k) => k in basicsSchema.shape)) setStep(0);
      }
      toast.error(existing ? "Couldn't save changes" : "Couldn't save the tournament", { description: errorMessage(err) });
    } finally {
      setSaving(null);
    }
  };

  const busy = saving !== null;
  const back = existing ? `/manager/tournaments/${existing.id}` : "/manager/tournaments";
  const stepHasProblem = [Object.keys(errors).some((k) => k !== "registrationOpensAt" && k !== "registrationClosesAt"), errorsCount > 0, !!schedule && !scheduleOk, !!(errors.registrationOpensAt || errors.registrationClosesAt)];

  return (
    <div>
      <BackLink to={back} label={existing ? "Back to tournament" : "All tournaments"} />
      <PageHeader
        eyebrow={existing ? "Edit tournament" : "New tournament"}
        title={title?.trim() || (existing ? existing.title : "Create a tournament")}
        description={existing ? "Changes are saved when you press Save." : "Four short steps. Nothing is visible to teams until you publish."}
      />

      {/* step header */}
      <nav aria-label="Steps" data-tour="wizard-steps" className="mb-6">
        <ol className="grid grid-cols-4 gap-1.5 sm:gap-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => void go(i)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "group relative flex w-full flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-xs font-semibold outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:gap-3 sm:px-3 sm:text-sm",
                    active ? "border-primary bg-primary/10 text-foreground shadow-glow" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg font-display text-sm font-bold transition-colors",
                      active ? "bg-primary text-primary-foreground" : done ? "bg-success/15 text-success" : "bg-muted",
                    )}
                  >
                    {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <span className="truncate">
                    <span className="hidden text-[10px] font-medium tracking-wider text-muted-foreground uppercase sm:block">Step {i + 1}</span>
                    {s.label}
                  </span>
                  {stepHasProblem[i] && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" aria-label="Needs attention" />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -24 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-6"
        >
          {step === 0 && (
            <>
              <Section icon={<Type />} title="Basics" description="What teams see when they find your tournament." tour="wizard-basics">
                <div className="grid gap-5">
                  <Field label="Tournament name" htmlFor="t-title" error={errors.title?.message}>
                    <Input id="t-title" placeholder="e.g. 7xen Winter Cup" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
                  </Field>
                  <Field label="Prize" optional htmlFor="t-prize" error={errors.prize?.message} hint="Shown big on the tournament page.">
                    <div className="relative">
                      <Trophy className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-warning-foreground dark:text-warning" />
                      <Input id="t-prize" placeholder="e.g. ₹50,000 prize pool" className="h-11 pl-9 text-base" {...register("prize")} />
                    </div>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Players per team" hint="Squad size, e.g. 4 for squads.">
                      <Controller control={control} name="teamSize" render={({ field }) => <Stepper value={field.value ?? 4} onChange={field.onChange} min={1} max={6} suffix="players" />} />
                    </Field>
                    <Field label="First team slot" error={errors.firstSlot?.message} hint="Many rooms keep slots 1–2 for observers.">
                      <Controller control={control} name="firstSlot" render={({ field }) => <Stepper value={field.value ?? 1} onChange={field.onChange} min={1} max={MAX_ROOM_SLOTS} />} />
                    </Field>
                  </div>
                  <Field label="Points system" hint="Used for every match in every stage.">
                    <Controller control={control} name="pointsSystem" render={({ field }) => <PointsPicker value={field.value ?? DEFAULT_POINTS_SYSTEM} onChange={field.onChange} />} />
                  </Field>
                </div>
              </Section>
              <Section icon={<FileText />} title="Description & rules" description="Optional — but teams appreciate clear rules.">
                <div className="grid gap-5">
                  <Field label="Description" optional htmlFor="t-desc" error={errors.description?.message}>
                    <Textarea id="t-desc" rows={3} placeholder="Who can join, what's at stake, where to follow the action…" {...register("description")} />
                  </Field>
                  <Field label="Rules" optional htmlFor="t-rules" error={errors.rules?.message}>
                    <Textarea id="t-rules" rows={5} placeholder={"e.g.\n• Be in the lobby 10 minutes before your group starts\n• No emulators\n• Teaming = disqualification"} {...register("rules")} />
                  </Field>
                </div>
              </Section>
            </>
          )}

          {step === 1 && (
            <>
              {formatLocked && <LockedNote text="Registration has opened, so the format can't change any more. You can still edit the basics." />}
              <fieldset disabled={formatLocked} className="min-w-0 space-y-6 disabled:opacity-70">
                <Section icon={<Users />} title="How big?" description="Pick a size. 7xen splits teams into lobbies and works out who goes through." tour="wizard-presets">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Format preset">
                    {PRESETS.map((p) => {
                      const on = preset === p.key;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => applyPreset(p.key)}
                          className={cn(
                            "relative rounded-xl border p-3.5 text-left outline-none transition-all hover:-translate-y-0.5 hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-4",
                            on ? "border-primary bg-primary/10 shadow-glow" : "bg-background",
                          )}
                        >
                          {on && (
                            <motion.span layoutId="preset-check" className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </motion.span>
                          )}
                          <p className="font-display text-2xl leading-tight font-bold">{p.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{p.flow}</p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <Field label="Total teams" hint="Registration closes when it's full; extra teams join a waitlist.">
                      <Stepper value={maxTeams} onChange={changeTotal} min={2} max={MAX_TOURNAMENT_TEAMS} suffix="teams" />
                    </Field>
                    <Field label="Teams per lobby" hint={`Default ${DEFAULT_LOBBY_SIZE}, max ${MAX_ROOM_SLOTS}.`}>
                      <Stepper value={lobby} onChange={changeLobby} min={2} max={MAX_ROOM_SLOTS} suffix="teams" />
                    </Field>
                  </div>
                </Section>

                <section data-tour="wizard-flow" className="animate-rise overflow-hidden rounded-xl border bg-card shadow-sm">
                  <div className="bg-grid border-b bg-gradient-to-br from-primary/10 to-transparent px-5 py-4">
                    <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Live preview</p>
                    <p className="font-display text-xl font-bold">How teams reach the final</p>
                  </div>
                  <div className="space-y-4 p-4 sm:p-5">
                    <FormatFlow stages={stages} maxTeams={maxTeams} issues={issues} />
                    <FormatIssues issues={issues} stageNames={stages.map((s) => s.name)} />
                  </div>
                </section>

                <div data-tour="wizard-stages" className="space-y-3">
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <h2 className="font-display text-xl font-bold">Stages</h2>
                      <p className="text-sm text-muted-foreground">Looks good? Move on. Want changes? Open a stage.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addStage} disabled={stages.length >= MAX_STAGES}>
                      <Plus /> Add a round
                    </Button>
                  </div>
                  <AnimatePresence initial={false}>
                    {stages.map((s, i) => (
                      <StageEditor
                        key={`${stages.length}-${i}`}
                        stage={s}
                        index={i}
                        isLast={i === stages.length - 1}
                        issues={issues.filter((x) => x.stage === i)}
                        onChange={(patch) => updateStage(i, patch)}
                        onRemove={stages.length > 1 && i < stages.length - 1 ? () => removeStage(i) : undefined}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              {formatLocked && <LockedNote text="To change the qualifier schedule now, open the stage from the tournament page." />}
              <Section
                icon={<CalendarClock />}
                title={`${stages[0]?.name ?? "Qualifier"} schedule`}
                description="Set the days and hours. Later stages can be scheduled from the tournament page once you know who qualified."
                tour="wizard-schedule"
              >
                {schedule ? (
                  <ScheduleEditor value={schedule} onChange={setSchedule} errors={scheduleErrors} minDate={todayInAppTz()} disabled={formatLocked} />
                ) : (
                  <Button type="button" onClick={() => { const d = defaultSchedule(stages[0]); if (d) setSchedule(d); }} disabled={formatLocked}>
                    <CalendarClock /> Set a schedule
                  </Button>
                )}
              </Section>
              {schedule && stages[0] && (
                <section data-tour="wizard-gantt" className="animate-rise rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                  <div className="mb-4">
                    <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Live preview</p>
                    <p className="font-display text-xl font-bold">
                      {stages[0].groupCount} groups × {stages[0].matchesPerGroup} matches
                    </p>
                  </div>
                  <SchedulePreview plan={plan} config={schedule} groupCount={stages[0].groupCount} onApply={formatLocked ? undefined : setSchedule} />
                </section>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <Section icon={<ClipboardList />} title="Registration" description="When teams can sign up.">
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Opens" optional error={errors.registrationOpensAt?.message} hint={opensAt ? undefined : "Leave empty to open the moment you publish."}>
                      <Controller
                        control={control}
                        name="registrationOpensAt"
                        render={({ field }) => <DateTimeInput label="Opens" value={field.value} onChange={field.onChange} placeholder="As soon as I publish" />}
                      />
                    </Field>
                    <Field label="Closes" optional error={errors.registrationClosesAt?.message} hint={closesAt ? undefined : "Leave empty to close when the first match starts."}>
                      <Controller
                        control={control}
                        name="registrationClosesAt"
                        render={({ field }) => <DateTimeInput label="Closes" value={field.value} onChange={field.onChange} placeholder="When play starts" invalid={!!errors.registrationClosesAt} />}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Explainer icon={<ListOrdered />} title="First come, first served">
                      The first {maxTeams} teams to register get a spot. When they register they rank the time slots they can play, and the draw honours those
                      in sign-up order.
                    </Explainer>
                    <Explainer icon={<Hourglass />} title="Waitlist">
                      Once it's full, teams can join the waitlist. If a team drops out before the draw, the next team on the waitlist gets their spot
                      automatically.
                    </Explainer>
                  </div>
                </div>
              </Section>

              <section data-tour="wizard-review" className="animate-rise overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="bg-grid relative overflow-hidden border-b bg-gradient-to-br from-primary/15 to-transparent p-5 sm:p-6">
                  <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Review</p>
                  <p className="mt-1 font-display text-3xl font-bold">{title?.trim() || "Untitled tournament"}</p>
                  {prize?.trim() && (
                    <p className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-warning-foreground dark:text-warning">
                      <Trophy className="size-5" /> {prize}
                    </p>
                  )}
                </div>
                <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
                  <ReviewItem label="Teams" value={`${maxTeams} teams · ${watch("teamSize") ?? 4} players each`} onEdit={() => void go(1)} />
                  <ReviewItem label="Format" value={stages.map((s) => s.name).join(" → ")} onEdit={() => void go(1)} />
                  <ReviewItem
                    label={`${stages[0]?.name ?? "Qualifier"} schedule`}
                    value={
                      schedule
                        ? `${formatDate(schedule.startDate)} → ${formatDate(schedule.endDate)} · ${schedule.windows.map((w) => `${formatTime(w.start)}–${formatTime(w.end)}`).join(", ")}${plan ? ` · ${plan.days} ${plan.days === 1 ? "evening" : "evenings"}` : ""}`
                        : "Not set yet"
                    }
                    bad={!schedule || !scheduleOk}
                    onEdit={() => void go(2)}
                  />
                  <ReviewItem label="Points" value={pointsLabel(pointsSystem)} onEdit={() => void go(0)} />
                  <ReviewItem label="Slots" value={`From #${firstSlot} in every lobby`} onEdit={() => void go(0)} />
                  <ReviewItem label="Registration" value={`${opensAt ? `Opens ${formatInstant(opensAt)}` : "Opens when published"} · ${closesAt ? `closes ${formatInstant(closesAt)}` : "closes when play starts"}`} />
                </div>
                {publishBlockers.length > 0 && (
                  <div className="mx-5 mb-5 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm sm:mx-6">
                    <p className="flex items-center gap-2 font-semibold">
                      <Info className="size-4" /> Before you can publish
                    </p>
                    <ul className="mt-1 list-disc pl-6 text-foreground/80">
                      {publishBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-muted-foreground">You can still save a draft and finish later.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* footer actions */}
      <div
        data-tour="wizard-actions"
        className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur lg:sticky lg:bottom-4 lg:z-10"
      >
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => void go(step - 1)} disabled={busy}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <Link to={back}>Cancel</Link>
          </Button>
        )}
        <span className="hidden flex-1 text-center text-xs text-muted-foreground sm:block">
          Step {step + 1} of {STEPS.length} · {STEPS[step]!.label}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {(step === 3 || isEdit) && (
            <Button type="button" variant="outline" onClick={() => void save(false)} disabled={busy}>
              {saving === "draft" ? <Loader2 className="animate-spin" /> : <Save />}
              {isEdit ? "Save changes" : "Save draft"}
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" size="lg" onClick={() => void go(step + 1)} disabled={busy}>
              Next: {STEPS[step + 1]!.label} <ArrowRight />
            </Button>
          ) : (
            (!existing || existing.status === "DRAFT") && (
              <Button type="button" size="lg" onClick={() => void save(true)} disabled={busy || publishBlockers.length > 0} className="shadow-glow">
                {saving === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
                Publish & open registration
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function LockedNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" /> {text}
    </p>
  );
}

function Explainer({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-muted/30 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4.5">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function ReviewItem({ label, value, onEdit, bad }: { label: string; value: string; onEdit?: () => void; bad?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-xl border bg-background p-3", bad && "border-warning/60")}>
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
        <p className="mt-0.5 text-sm font-medium break-words">{value}</p>
      </div>
      {onEdit && (
        <Button type="button" variant="ghost" size="xs" onClick={onEdit}>
          <ScrollText /> Edit
        </Button>
      )}
    </div>
  );
}

function WizardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

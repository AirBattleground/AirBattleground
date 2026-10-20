import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  Eye,
  GitBranch,
  Image as ImageIcon,
  Info,
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
  defaultStageMaps,
  defaultStageName,
  MAX_ROOM_SLOTS,
  MAX_STAGES,
  MAX_TOURNAMENT_TEAMS,
  scheduleConfigSchema,
  suggestRounds,
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
import { api } from "@/lib/api";
import { uploadImage } from "@/features/manager/branding";
import { BrandingImageCard } from "@/features/manager/components/BrandingImageCard";
import { QueryError } from "@/features/manager/components/QueryError";
import { Stepper } from "@/features/manager/components/Stepper";
import { errorMessage, useCreateTournament, usePublishTournament, useTournament, useUpdateTournament } from "@/features/tournaments/manager/api";
import { fittingSchedule, groupSizes, normalizeStages, planSchedule, teamsOut, validateFormat } from "@/features/tournaments/manager/engine";
import { formatInstant } from "@/features/tournaments/manager/format";
import { DateTimeInput } from "@/features/tournaments/manager/components/DateTimeInput";
import { Advanced, Field, Section } from "@/features/tournaments/manager/components/form";
import { WizardSteps } from "@/features/tournaments/manager/components/WizardSteps";
import { Zone } from "@/features/tournaments/manager/components/Zone";
import { FormatFlow } from "@/features/tournaments/manager/components/FormatFlow";
import { FormatIssues } from "@/features/tournaments/manager/components/FormatIssues";
import { PointsPicker, pointsLabel } from "@/features/tournaments/manager/components/PointsPicker";
import { ScheduleEditor } from "@/features/tournaments/manager/components/ScheduleEditor";
import { SchedulePreview } from "@/features/tournaments/manager/components/SchedulePreview";
import { StageEditor } from "@/features/tournaments/manager/components/StageEditor";
import { coinsLabel, WinCoinsInput } from "@/features/coins/components/WinCoinsInput";

const TOUR: TourStep[] = [
  { title: "Create a tournament", description: "Five short steps. Nothing goes live until you press Publish — you can save a draft any time." },
  { element: '[data-tour="wizard-steps"]', title: "Five steps", description: "Basics → Format → Schedule → Sign-up → Review. Tap a step to jump back to it." },
  { element: '[data-tour="wizard-basics"]', title: "Name and prize", description: "What teams see first, plus the BG coins each match winner earns. Team size, points and rules are under “More options”." },
  { element: '[data-tour="wizard-poster"]', title: "Poster", description: "Add the tournament poster here. It's saved together with the tournament." },
  { element: '[data-tour="wizard-presets"]', title: "Pick a size", description: "Choose a ready-made format. AirBattleground works out the groups and who goes through." },
  { element: '[data-tour="wizard-flow"]', title: "Live preview", description: "See how teams flow from registration to the final. It updates as you change numbers." },
  { element: '[data-tour="wizard-stages"]', title: "Rounds", description: "Rounds get names and maps automatically. Open “Customise rounds” to reorder them or change maps, lobbies and how many go through." },
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
  winCoins: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
});
type BasicsIn = z.input<typeof basicsSchema>;
type BasicsOut = z.output<typeof basicsSchema>;

const STEPS = [
  { key: "basics", label: "Basics", icon: Type },
  { key: "format", label: "Format", icon: GitBranch },
  { key: "schedule", label: "Schedule", icon: CalendarClock },
  { key: "registration", label: "Sign-up", icon: ClipboardList },
  { key: "review", label: "Review", icon: Eye },
] as const;
const LAST = STEPS.length - 1;

const PRESETS: { key: string; teams: number | null; title: string; flow: string }[] = [
  { key: "final16", teams: 16, title: "16 teams", flow: "Final only" },
  { key: "q64", teams: 64, title: "64 teams", flow: "Round 1 → Final" },
  { key: "q128", teams: 128, title: "128 teams", flow: "Round 1 → Round 2 → Final" },
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
    suggestRounds({ totalTeams: total, lobbySize: lobby }).map((s): StageSpec => ({ ...s, schedule: null })),
    total,
  );
  if (next[0]) next[0].schedule = schedule === "auto" ? defaultSchedule(next[0]) : schedule;
  return next;
}

/** Per-stage UI flags (kept beside the specs): auto-named / auto-mapped stages follow their position when rounds move. */
interface StageMeta {
  id: string;
  autoName: boolean;
  autoMaps: boolean;
}
const newMeta = (auto: boolean): StageMeta => ({ id: Math.random().toString(36).slice(2, 10), autoName: auto, autoMaps: auto });

/** Re-apply position-based names and maps to every stage that hasn't been customised. */
function relabel(specs: StageSpec[], metas: StageMeta[]): StageSpec[] {
  return specs.map((s, i) => {
    const last = i === specs.length - 1;
    let out = s;
    if (metas[i]?.autoName) out = { ...out, name: defaultStageName(i, last) };
    if (metas[i]?.autoMaps) {
      const maps = defaultStageMaps(i, last);
      out = { ...out, maps, matchesPerGroup: maps.length };
    }
    return out;
  });
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
  // TDM battles have their own (simpler) wizard
  if (q.data?.mode === "TDM") return <Navigate replace to={`/manager/tdm/${q.data.id}/edit`} />;
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
  const initialStep = Math.min(LAST, Math.max(0, Number(params.get("step") ?? 0) || 0));
  const [step, setStep] = useState(initialStep);
  const [dir, setDir] = useState(1);

  // ----- format state (kept outside the form; validated with the shared schema on save) -----
  const [maxTeams, setMaxTeams] = useState(existing?.maxTeams ?? 64);
  const [lobby, setLobby] = useState(existing?.stages[0]?.lobbySize ?? DEFAULT_LOBBY_SIZE);
  const [preset, setPreset] = useState(existing ? "custom" : "q64");
  const [stages, setStages] = useState<StageSpec[]>(() => (existing ? existing.stages.map(toSpec) : buildFormat(64, DEFAULT_LOBBY_SIZE, "auto")));
  // existing tournaments keep their own names/maps; new ones follow the defaults by position
  const [meta, setMeta] = useState<StageMeta[]>(() => stages.map(() => newMeta(!existing)));
  const schedule = stages[0]?.schedule ?? null;
  // until the organiser edits the schedule themselves, keep it sized to fit the chosen format
  const [scheduleTouched, setScheduleTouched] = useState(isEdit);
  // poster: picked here, uploaded right after the tournament is saved
  const qc = useQueryClient();
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterRemoved, setPosterRemoved] = useState(false);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!posterFile) return setPosterPreview(null);
    const url = URL.createObjectURL(posterFile);
    setPosterPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [posterFile]);
  const posterUrl = posterFile ? posterPreview : posterRemoved ? null : (existing?.posterUrl ?? null);
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
          winCoins: existing.winCoins,
          registrationOpensAt: existing.registrationOpensAt ?? undefined,
          registrationClosesAt: existing.registrationClosesAt ?? undefined,
        }
      : { title: "", description: "", rules: "", prize: "", teamSize: 4, firstSlot: 3, pointsSystem: DEFAULT_POINTS_SYSTEM, winCoins: 0 },
  });
  const { register, control, watch, trigger, getValues, setError, formState } = form;
  const { errors } = formState;
  const title = watch("title");
  const prize = watch("prize");
  const firstSlot = watch("firstSlot") ?? 1;
  const pointsSystem = watch("pointsSystem") ?? DEFAULT_POINTS_SYSTEM;
  const winCoins = watch("winCoins") ?? 0;
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
  /** Replace the whole format (presets / team count / lobby size): every stage goes back to automatic names + maps. */
  const resetFormat = (next: StageSpec[]) => {
    setStages(next);
    setMeta(next.map(() => newMeta(true)));
  };
  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p?.teams) return;
    setMaxTeams(p.teams);
    resetFormat(buildFormat(p.teams, lobby, formatSchedule()));
  };
  const changeTotal = (n: number) => {
    setMaxTeams(n);
    setPreset(PRESETS.find((p) => p.teams === n)?.key ?? "custom");
    resetFormat(buildFormat(n, lobby, formatSchedule()));
  };
  const changeLobby = (n: number) => {
    setLobby(n);
    resetFormat(buildFormat(maxTeams, n, formatSchedule()));
  };
  /** Apply a new stage list: the qualifier schedule stays with whichever stage is first, names/maps follow position. */
  const commitStages = (specs: StageSpec[], metas: StageMeta[]) => {
    const carried = stages[0]?.schedule ?? null;
    const withSchedule = specs.map((s, i) => (i === 0 ? { ...s, schedule: s.schedule ?? carried } : { ...s, schedule: null }));
    setMeta(metas);
    setStages(normalizeStages(relabel(withSchedule, metas), maxTeams));
  };
  const updateStage = (i: number, patch: Partial<StageSpec>) => {
    const metas = meta.map((m, j) => (j === i ? { ...m, autoName: patch.name !== undefined ? false : m.autoName, autoMaps: patch.maps !== undefined ? false : m.autoMaps } : m));
    setMeta(metas);
    setStages(normalizeStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)), maxTeams));
  };
  /** New rounds go in just before the Final and are named + mapped automatically — drag them where you want. */
  const addStage = () => {
    const at = Math.max(0, stages.length - 1);
    const base = stages[Math.max(0, at - 1)] ?? stages[0]!;
    // size the new round for the teams that reach it: enough lobbies, about half of each group goes through
    const incoming = at === 0 ? maxTeams : teamsOut(stages[at - 1]!, false);
    const groupCount = Math.max(1, Math.ceil(incoming / base.lobbySize));
    const smallest = Math.max(1, Math.floor(incoming / groupCount));
    const advancePerGroup = Math.max(1, Math.min(smallest - 1, Math.floor(smallest / 2)));
    const extra: StageSpec = { ...base, groupCount, advancePerGroup, invitedSlots: 0, wildcardCount: 0, schedule: null };
    commitStages([...stages.slice(0, at), extra, ...stages.slice(at)], [...meta.slice(0, at), newMeta(true), ...meta.slice(at)]);
  };
  const removeStage = (i: number) => commitStages(stages.filter((_, j) => j !== i), meta.filter((_, j) => j !== i));
  /**
   * `ids` = the new order of every stage except the Final (which always stays last). A round's name and maps travel with
   * it; the team flow (lobbies, groups, who goes through, schedule) stays with the position, so every order stays valid.
   */
  const reorderStages = (ids: string[]) => {
    const order = [...ids, meta[meta.length - 1]!.id];
    const idx = order.map((id) => meta.findIndex((m) => m.id === id));
    if (idx.some((n) => n < 0) || idx.every((n, k) => n === k)) return;
    const specs = stages.map((slot, k) => {
      const moved = stages[idx[k]!]!;
      return { ...slot, name: moved.name, maps: moved.maps, matchesPerGroup: moved.matchesPerGroup };
    });
    commitStages(specs, idx.map((n) => meta[n]!));
  };
  const moveStage = (i: number, dir: -1 | 1) => {
    const ids = meta.slice(0, -1).map((m) => m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorderStages(ids);
  };
  const setSchedule = (cfg: ScheduleConfig) => {
    setScheduleTouched(true);
    setStages((list) => list.map((s, j) => (j === 0 ? { ...s, schedule: cfg } : s)));
  };

  // ----- navigation -----
  const go = async (to: number) => {
    if (to > step && step === 0) {
      const ok = await trigger(["title", "prize", "description", "rules", "teamSize", "firstSlot", "pointsSystem", "winCoins"]);
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
      try {
        if (posterFile) await uploadImage(`/api/manager/tournaments/${saved.id}/poster`, posterFile);
        else if (posterRemoved && existing?.posterUrl) await api.del(`/api/manager/tournaments/${saved.id}/poster`);
      } catch (err) {
        toast.warning("Saved, but the poster didn't upload", { description: `${errorMessage(err)} You can add it again by editing the tournament.` });
      }
      void qc.invalidateQueries({ queryKey: ["manager", "tournaments"] });
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
  const stepHasProblem = [Object.keys(errors).some((k) => k !== "registrationOpensAt" && k !== "registrationClosesAt"), errorsCount > 0, !!schedule && !scheduleOk, !!(errors.registrationOpensAt || errors.registrationClosesAt), false];

  return (
    <div>
      <BackLink to={back} label={existing ? "Back to tournament" : "All tournaments"} />
      <PageHeader
        eyebrow={existing ? "Edit tournament" : "New tournament"}
        title={title?.trim() || (existing ? existing.title : "Create a tournament")}
        description={existing ? undefined : "Nothing is visible to teams until you publish."}
      />

      <WizardSteps steps={STEPS} step={step} onGo={(i) => void go(i)} problems={stepHasProblem} tour="wizard-steps" />

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
            <Section icon={<Type />} title="Basics" tour="wizard-basics">
              <div className="grid gap-5">
                <Field label="Tournament name" htmlFor="t-title" error={errors.title?.message}>
                  <Input id="t-title" placeholder="e.g. AirBattleground Winter Cup" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Prize" optional htmlFor="t-prize" error={errors.prize?.message}>
                    <div className="relative">
                      <Trophy className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-warning-foreground dark:text-warning" />
                      <Input id="t-prize" placeholder="e.g. ₹50,000 prize pool" className="h-11 pl-9 text-base" {...register("prize")} />
                    </div>
                  </Field>
                  <Field label="BG coins per match win" htmlFor="t-coins" error={errors.winCoins?.message}>
                    <Controller control={control} name="winCoins" render={({ field }) => <WinCoinsInput id="t-coins" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.winCoins} />} />
                  </Field>
                </div>
                <BrandingImageCard
                  title="Poster"
                  icon={<ImageIcon />}
                  description="Optional · square artwork looks best."
                  aspect="square"
                  compact
                  url={posterUrl}
                  onUpload={(f) => {
                    setPosterFile(f);
                    setPosterRemoved(false);
                  }}
                  onRemove={() => {
                    setPosterFile(null);
                    setPosterRemoved(true);
                  }}
                  tour="wizard-poster"
                  className="shadow-none"
                />
                <Advanced
                  title="More options"
                  hint={`${watch("teamSize") ?? 4} players · slots from #${firstSlot} · ${pointsLabel(pointsSystem)}`}
                  defaultOpen={!!(errors.firstSlot || errors.teamSize || errors.pointsSystem || errors.description || errors.rules)}
                >
                  <div className="grid gap-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Players per team">
                        <Controller control={control} name="teamSize" render={({ field }) => <Stepper value={field.value ?? 4} onChange={field.onChange} min={1} max={6} suffix="players" />} />
                      </Field>
                      <Field label="First team slot" error={errors.firstSlot?.message} hint="Rooms often keep 1–2 for observers.">
                        <Controller control={control} name="firstSlot" render={({ field }) => <Stepper value={field.value ?? 1} onChange={field.onChange} min={1} max={MAX_ROOM_SLOTS} />} />
                      </Field>
                    </div>
                    <Field label="Points system">
                      <Controller control={control} name="pointsSystem" render={({ field }) => <PointsPicker value={field.value ?? DEFAULT_POINTS_SYSTEM} onChange={field.onChange} />} />
                    </Field>
                    <Field label="Description" optional htmlFor="t-desc" error={errors.description?.message}>
                      <Textarea id="t-desc" rows={3} placeholder="Who can join, what's at stake, where to follow the action…" {...register("description")} />
                    </Field>
                    <Field label="Rules" optional htmlFor="t-rules" error={errors.rules?.message}>
                      <Textarea id="t-rules" rows={5} placeholder={"e.g.\n• Be in the lobby 10 minutes before your group starts\n• No emulators\n• Teaming = disqualification"} {...register("rules")} />
                    </Field>
                  </div>
                </Advanced>
              </div>
            </Section>
          )}

          {step === 1 && (
            <>
              {formatLocked && <LockedNote text="Registration has opened, so the format can't change any more. You can still edit the basics." />}
              <fieldset disabled={formatLocked} className="min-w-0 space-y-6 disabled:opacity-70">
                <Section icon={<Users />} title="How big?" tour="wizard-presets">
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
                    <Field label="Total teams" hint="Extra teams join a waitlist.">
                      <Stepper value={maxTeams} onChange={changeTotal} min={2} max={MAX_TOURNAMENT_TEAMS} suffix="teams" />
                    </Field>
                    <Field label="Teams per lobby" hint={`Max ${MAX_ROOM_SLOTS}.`}>
                      <Stepper value={lobby} onChange={changeLobby} min={2} max={MAX_ROOM_SLOTS} suffix="teams" />
                    </Field>
                  </div>
                </Section>

                <Zone label="Live preview · how teams reach the final" data-tour="wizard-flow" className="animate-rise" bodyClassName="space-y-4">
                  <FormatFlow stages={stages} maxTeams={maxTeams} issues={issues} />
                  <FormatIssues issues={issues} stageNames={stages.map((s) => s.name)} />
                </Zone>

                <Advanced
                  tour="wizard-stages"
                  title="Customise rounds"
                  hint={stages.map((s) => s.name).join(" → ")}
                  defaultOpen={issues.some((x) => x.stage != null)}
                >
                  <div className="space-y-3">
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={addStage} disabled={stages.length >= MAX_STAGES}>
                      <Plus /> Add a round
                    </Button>
                  </div>
                  <Reorder.Group axis="y" values={meta.slice(0, -1).map((m) => m.id)} onReorder={reorderStages} as="div" className="space-y-3">
                    <AnimatePresence initial={false}>
                      {stages.slice(0, -1).map((s, i) => (
                        <SortableStage
                          key={meta[i]!.id}
                          id={meta[i]!.id}
                          stage={s}
                          index={i}
                          issues={issues.filter((x) => x.stage === i)}
                          onChange={(patch) => updateStage(i, patch)}
                          onRemove={stages.length > 1 ? () => removeStage(i) : undefined}
                          onMove={(dir) => moveStage(i, dir)}
                          canMoveUp={i > 0}
                          canMoveDown={i < stages.length - 2}
                          draggable={stages.length > 2}
                        />
                      ))}
                    </AnimatePresence>
                  </Reorder.Group>
                  {stages.length > 0 && (
                    <StageEditor
                      key={meta[stages.length - 1]!.id}
                      stage={stages[stages.length - 1]!}
                      index={stages.length - 1}
                      isLast
                      issues={issues.filter((x) => x.stage === stages.length - 1)}
                      onChange={(patch) => updateStage(stages.length - 1, patch)}
                    />
                  )}
                  </div>
                </Advanced>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              {formatLocked && <LockedNote text="To change the qualifier schedule now, open the stage from the tournament page." />}
              <Section
                icon={<CalendarClock />}
                title={`${stages[0]?.name ?? "Qualifier"} schedule`}
                description="Later stages are scheduled from the tournament page."
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
                <Zone label={`Live preview · ${stages[0].groupCount} groups × ${stages[0].matchesPerGroup} matches`} data-tour="wizard-gantt" className="animate-rise">
                  <SchedulePreview plan={plan} config={schedule} groupCount={stages[0].groupCount} onApply={formatLocked ? undefined : setSchedule} />
                </Zone>
              )}
            </>
          )}

          {step === 3 && (
            <Section icon={<ClipboardList />} title="Sign-up" description={`First ${maxTeams} teams get a spot · the rest join a waitlist and move up if a team drops out.`}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Opens" optional error={errors.registrationOpensAt?.message}>
                  <Controller
                    control={control}
                    name="registrationOpensAt"
                    render={({ field }) => <DateTimeInput label="Opens" value={field.value} onChange={field.onChange} placeholder="As soon as I publish" />}
                  />
                </Field>
                <Field label="Closes" optional error={errors.registrationClosesAt?.message}>
                  <Controller
                    control={control}
                    name="registrationClosesAt"
                    render={({ field }) => <DateTimeInput label="Closes" value={field.value} onChange={field.onChange} placeholder="When play starts" invalid={!!errors.registrationClosesAt} />}
                  />
                </Field>
              </div>
            </Section>
          )}

          {step === 4 && (
            <>
              <section data-tour="wizard-review" className="animate-rise overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="border-b bg-gradient-to-br from-primary/12 to-transparent p-4 sm:p-5">
                  <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Review</p>
                  <p className="mt-1 font-display text-2xl font-bold sm:text-3xl">{title?.trim() || "Untitled tournament"}</p>
                  {prize?.trim() && (
                    <p className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-warning-foreground dark:text-warning">
                      <Trophy className="size-5" /> {prize}
                    </p>
                  )}
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                  <ReviewItem label="Teams" value={`${maxTeams} teams · ${watch("teamSize") ?? 4} players each`} onEdit={() => void go(1)} />
                  {posterUrl && <ReviewItem label="Poster" value="Added" onEdit={() => void go(0)} />}
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
                  <ReviewItem label="Match win reward" value={coinsLabel(winCoins)} onEdit={() => void go(0)} />
                  <ReviewItem label="Slots" value={`From #${firstSlot} in every lobby`} onEdit={() => void go(0)} />
                  <ReviewItem label="Sign-up" value={`${opensAt ? `Opens ${formatInstant(opensAt)}` : "Opens when published"} · ${closesAt ? `closes ${formatInstant(closesAt)}` : "closes when play starts"}`} onEdit={() => void go(3)} />
                </div>
                {publishBlockers.length > 0 && (
                  <div className="mx-4 mb-4 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm sm:mx-5 sm:mb-5">
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
          {(step === LAST || isEdit) && (
            <Button type="button" variant="outline" onClick={() => void save(false)} disabled={busy}>
              {saving === "draft" ? <Loader2 className="animate-spin" /> : <Save />}
              {isEdit ? "Save changes" : "Save draft"}
            </Button>
          )}
          {step < LAST ? (
            <Button type="button" size="lg" onClick={() => void go(step + 1)} disabled={busy}>
              Next<span className="hidden sm:inline">: {STEPS[step + 1]!.label}</span> <ArrowRight />
            </Button>
          ) : (
            (!existing || existing.status === "DRAFT") && (
              <Button type="button" size="lg" onClick={() => void save(true)} disabled={busy || publishBlockers.length > 0} className="shadow-glow">
                {saving === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
                Publish<span className="hidden sm:inline"> & open registration</span>
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function SortableStage({ id, draggable, ...props }: { id: string; draggable: boolean; stage: StageSpec; index: number; issues: FormatIssue[]; onChange: (patch: Partial<StageSpec>) => void; onRemove?: () => void; onMove: (dir: -1 | 1) => void; canMoveUp: boolean; canMoveDown: boolean }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={id} dragListener={false} dragControls={controls} whileDrag={{ scale: 1.01, boxShadow: "0 12px 32px -12px var(--glow)", zIndex: 20 }} className="relative">
      <StageEditor {...props} isLast={false} dragControls={draggable ? controls : undefined} />
    </Reorder.Item>
  );
}

function LockedNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" /> {text}
    </p>
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
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

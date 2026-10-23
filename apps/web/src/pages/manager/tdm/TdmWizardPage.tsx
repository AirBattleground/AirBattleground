import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Coins, Crown, Eye, Image as ImageIcon, Loader2, Rocket, Save, Swords, Trophy, Type } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  ApiError,
  createTournamentSchema,
  MAP_LABELS,
  TDM_BEST_OF,
  TDM_MAPS,
  TDM_POINTS,
  TDM_TEAM_COUNTS,
  tdmFinishTime,
  tdmStages,
  todayInAppTz,
  type CreateTournamentInput,
  type GameMap,
  type ManagerTournamentDetail,
  type UpdateTournamentInput,
} from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { formatDate, formatTime } from "@/features/manager/format";
import { api } from "@/lib/api";
import { uploadImage } from "@/features/manager/branding";
import { BrandingImageCard } from "@/features/manager/components/BrandingImageCard";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { QueryError } from "@/features/manager/components/QueryError";
import { Stepper } from "@/features/manager/components/Stepper";
import { TimeSelect } from "@/features/manager/components/TimeSelect";
import { MAP_STYLES } from "@/features/manager/components/maps";
import { errorMessage, useCreateTournament, usePublishTournament, useTournament, useUpdateTournament } from "@/features/tournaments/manager/api";
import { DateTimeInput } from "@/features/tournaments/manager/components/DateTimeInput";
import { Advanced, Field, Section } from "@/features/tournaments/manager/components/form";
import { WizardSteps } from "@/features/tournaments/manager/components/WizardSteps";
import { Zone } from "@/features/tournaments/manager/components/Zone";
import { formatInstant } from "@/features/tournaments/manager/format";
import { coinsLabel, WinCoinsInput } from "@/features/coins/components/WinCoinsInput";

const TOUR: TourStep[] = [
  { title: "Create a TDM battle", description: "A knockout of 2-team Team Deathmatch matches. Five short steps — nothing goes live until you publish." },
  { element: '[data-tour="tdm-steps"]', title: "Five steps", description: "Basics → Bracket → When → Coins → Review. Tap a step to jump to it." },
  { element: '[data-tour="tdm-basics"]', title: "Name it", description: "What teams see when they browse TDM battles." },
  { element: '[data-tour="tdm-poster"]', title: "Poster", description: "Add the battle's poster. Teams see it in the list and on the battle page." },
  { element: '[data-tour="tdm-preview"]', title: "Live bracket", description: "The bracket and its times update as you go. Publish from the Review step." },
  { element: '[data-tour="tdm-actions"]', title: "Back and next", description: "Move between steps here. Save a draft or publish on the last step." },
];

const STEPS = [
  { key: "basics", label: "Basics", icon: Type },
  { key: "bracket", label: "Bracket", icon: Swords },
  { key: "when", label: "When", icon: CalendarClock },
  { key: "coins", label: "Coins", icon: Coins },
  { key: "review", label: "Review", icon: Eye },
] as const;
const LAST = STEPS.length - 1;
/** Which step each form field lives on (for jumping to the first error). */
const FIELD_STEP: Record<string, number> = { title: 0, prize: 0, description: 0, registrationClosesAt: 2, winCoins: 3 };

const basicsSchema = createTournamentSchema.pick({ title: true, description: true, prize: true, winCoins: true, registrationClosesAt: true });
type BasicsIn = z.input<typeof basicsSchema>;
type BasicsOut = z.output<typeof basicsSchema>;

export default function TdmWizardPage() {
  const { tournamentId } = useParams();
  const q = useTournament(tournamentId);
  if (tournamentId && q.isError)
    return (
      <>
        <BackLink to="/manager/tdm" />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this TDM battle" />
      </>
    );
  if (tournamentId && !q.data) return <Skeleton className="h-[32rem] rounded-xl" />;
  return <TdmWizard key={tournamentId ?? "new"} existing={tournamentId ? q.data : undefined} />;
}

function BackLink({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to={to}>
        <ArrowLeft /> Back
      </Link>
    </Button>
  );
}

function TdmWizard({ existing }: { existing?: ManagerTournamentDetail }) {
  usePageTour("manager.tdmWizard", TOUR);
  const navigate = useNavigate();
  const create = useCreateTournament();
  const update = useUpdateTournament(existing?.id ?? "");
  const publish = usePublishTournament();
  const locked = !!existing && !existing.canEditFormat;
  const first = existing?.stages[0];
  const firstSchedule = first?.schedule ?? null;

  // ----- bracket (outside the form; turned into stages on save) -----
  const [teams, setTeams] = useState<number>(existing?.maxTeams ?? 4);
  const [bestOf, setBestOf] = useState<number>(first?.matchesPerGroup ?? 1);
  const [maps, setMaps] = useState<GameMap[]>(() => (first ? [...new Set(first.maps)] : ["WAREHOUSE"]));
  const [date, setDate] = useState<string>(firstSchedule?.startDate ?? addDays(todayInAppTz(), 1));
  const [startTime, setStartTime] = useState<string>(firstSchedule?.windows[0]?.start ?? "19:00");
  const [rooms, setRooms] = useState<number>(firstSchedule?.parallelLobbies ?? 2);

  const stages = useMemo(() => tdmStages({ teams, bestOf, maps, date, startTime, parallel: rooms }), [teams, bestOf, maps, date, startTime, rooms]);
  const finish = tdmFinishTime({ teams, bestOf, startTime, parallel: rooms });

  const form = useForm<BasicsIn, unknown, BasicsOut>({
    resolver: zodResolver(basicsSchema),
    mode: "onTouched",
    defaultValues: {
      title: existing?.title ?? "",
      description: existing?.description ?? "",
      prize: existing?.prize ?? "",
      winCoins: existing?.winCoins ?? 100,
      registrationClosesAt: existing?.registrationClosesAt ?? undefined,
    },
  });
  const { register, control, handleSubmit, setError, watch, trigger, formState } = form;
  const { errors } = formState;
  const title = watch("title");
  const winCoins = watch("winCoins") ?? 0;

  // poster: picked here, uploaded right after the battle is saved
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

  // ----- steps -----
  const [step, setStep] = useState(0);
  const bracketProblem = !locked && maps.length === 0;
  const whenProblem = !locked && !finish;
  /** Checks a step before moving past it; returns false (with a toast) when something needs fixing. */
  const checkStep = async (i: number): Promise<boolean> => {
    if (i === 0) return trigger(["title", "prize", "description"]);
    if (i === 1 && bracketProblem) {
      toast.error("Pick at least one TDM map");
      return false;
    }
    if (i === 2) {
      if (whenProblem) {
        toast.error("The bracket doesn't finish before midnight", { description: "Start earlier, use more rooms at once, or play fewer matches per round." });
        return false;
      }
      return trigger("registrationClosesAt");
    }
    if (i === 3) return trigger("winCoins");
    return true;
  };
  const go = async (to: number) => {
    for (let i = step; i < to; i++) if (!(await checkStep(i))) return setStep(i);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const save = (andPublish: boolean) =>
    handleSubmit(async (basics) => {
      if (!locked && !finish) {
        setStep(2);
        toast.error("The bracket doesn't finish before midnight", { description: "Start earlier, use more rooms at once, or play fewer matches per round." });
        return;
      }
      if (!locked && maps.length === 0) {
        setStep(1);
        toast.error("Pick at least one TDM map");
        return;
      }
      setSaving(andPublish ? "publish" : "draft");
      try {
        let saved: ManagerTournamentDetail;
        if (existing) {
          const input: UpdateTournamentInput = locked ? basics : { ...basics, maxTeams: teams, stages };
          saved = await update.mutateAsync(input);
        } else {
          const input: CreateTournamentInput = createTournamentSchema.parse({
            ...basics,
            mode: "TDM",
            teamSize: 4,
            firstSlot: 1,
            maxTeams: teams,
            pointsSystem: TDM_POINTS,
            stages,
          });
          saved = await create.mutateAsync(input);
        }
        try {
          if (posterFile) await uploadImage(`/api/manager/tournaments/${saved.id}/poster`, posterFile);
          else if (posterRemoved && existing?.posterUrl) await api.del(`/api/manager/tournaments/${saved.id}/poster`);
        } catch (err) {
          toast.warning("Saved, but the poster didn't upload", { description: `${errorMessage(err)} You can add it again by editing the battle.` });
        }
        if (andPublish && saved.status === "DRAFT") {
          try {
            saved = await publish.mutateAsync(saved.id);
            toast.success("Published — teams can register now", { description: saved.title });
          } catch (err) {
            toast.error("Saved as a draft, but couldn't publish yet", { description: errorMessage(err) });
          }
        } else {
          toast.success(existing ? "Changes saved" : "Draft saved", { description: saved.title });
        }
        navigate(`/manager/tournaments/${saved.id}`);
      } catch (err) {
        if (err instanceof ApiError && err.fields) {
          for (const [k, msg] of Object.entries(err.fields)) setError(k as keyof BasicsIn, { message: msg });
          const at = Object.keys(err.fields).map((k) => FIELD_STEP[k]).filter((n): n is number => n != null);
          if (at.length) setStep(Math.min(...at));
        }
        toast.error("Couldn't save the TDM battle", { description: errorMessage(err) });
      } finally {
        setSaving(null);
      }
    }, (errs) => {
      const at = Object.keys(errs).map((k) => FIELD_STEP[k]).filter((n): n is number => n != null);
      if (at.length) setStep(Math.min(...at));
      toast.error("Please check the highlighted fields");
    })();

  const back = existing ? `/manager/tournaments/${existing.id}` : "/manager/tdm";
  const busy = saving !== null;

  const isDraft = !existing || existing.status === "DRAFT";
  const problems = [!!(errors.title || errors.prize || errors.description), bracketProblem, whenProblem || !!errors.registrationClosesAt, !!errors.winCoins, false];

  const preview = (
    <Zone label="Live bracket" data-tour="tdm-preview" bodyClassName="space-y-3">
      <div>
        <p className="truncate font-display text-xl font-bold">{title?.trim() || "Untitled battle"}</p>
        <p className="text-sm text-muted-foreground">
          {teams} teams · {bestOf === 1 ? "1 match" : `best of ${bestOf}`} per round
        </p>
      </div>
      <ol className="space-y-1.5">
        {stages.map((s, i) => (
          <li key={s.name} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg font-display text-sm font-bold", i === stages.length - 1 ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary")}>
              {i === stages.length - 1 ? <Trophy className="size-4" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.name}</span>
              <span className="block text-xs text-muted-foreground">{s.groupCount === 1 ? "1 match-up" : `${s.groupCount} match-ups`}</span>
            </span>
            {s.schedule && <span className="shrink-0 font-display text-sm font-bold tabular-nums">{formatTime(s.schedule.windows[0]!.start)}</span>}
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Crown className="size-5 text-warning-foreground dark:text-warning" />
          <span className="flex-1 font-semibold">Champion</span>
          <span className="text-xs font-semibold">{coinsLabel(winCoins)}</span>
        </li>
      </ol>
      {!locked &&
        (finish ? (
          <p className="text-sm text-muted-foreground">
            Final ends around <span className="font-semibold text-foreground">{formatTime(finish)}</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Runs past midnight — start earlier, add rooms, or play fewer matches.
          </p>
        ))}
    </Zone>
  );

  return (
    <>
      <BackLink to={back} />
      <PageHeader
        eyebrow={existing ? "Edit TDM battle" : "New TDM battle"}
        title={existing ? existing.title : title?.trim() || "Create a TDM battle"}
        description={existing ? undefined : "2-team knockout · nothing is visible to teams until you publish."}
      />

      <WizardSteps steps={STEPS} step={step} onGo={(i) => void (i > step ? go(i) : setStep(i))} problems={problems} tour="tdm-steps" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {step === 0 && (
            <Section icon={<Type />} title="Basics" tour="tdm-basics">
              <div className="grid gap-5">
                <Field label="Battle name" htmlFor="tdm-title" error={errors.title?.message}>
                  <Input id="tdm-title" placeholder="e.g. Friday Night TDM Knockout" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
                </Field>
                <Field label="Prize" optional htmlFor="tdm-prize" error={errors.prize?.message}>
                  <Input id="tdm-prize" placeholder="e.g. ₹2,000 for the champion" className="h-11 text-base" {...register("prize")} />
                </Field>
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
                  tour="tdm-poster"
                  className="shadow-none"
                />
                <Advanced title="Description" hint="Optional · rules, eligibility" defaultOpen={!!errors.description || !!existing?.description}>
                  <Field label="Description" optional htmlFor="tdm-desc" error={errors.description?.message}>
                    <Textarea id="tdm-desc" rows={3} placeholder="e.g. 4v4. Be in the room 5 minutes before your match." {...register("description")} />
                  </Field>
                </Advanced>
              </div>
            </Section>
          )}

          {step === 1 && (
            <Section icon={<Swords />} title="Bracket" description={locked ? "The bracket is fixed once published." : undefined} tour="tdm-bracket">
              <fieldset disabled={locked} className="grid gap-6 disabled:opacity-60">
                <Field label="Number of teams">
                  <ToggleGroup type="single" variant="outline" value={String(teams)} onValueChange={(v) => v && setTeams(Number(v))} className="flex-wrap justify-start">
                    {TDM_TEAM_COUNTS.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)} className="h-11 min-w-14 font-display text-lg font-bold">
                        {n}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                <Field label="Matches per round" hint={bestOf > 1 ? `First to win ${Math.ceil(bestOf / 2)} goes through.` : undefined}>
                  <ToggleGroup type="single" variant="outline" value={String(bestOf)} onValueChange={(v) => v && setBestOf(Number(v))} className="flex-wrap justify-start">
                    {TDM_BEST_OF.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)} className="h-11 px-4 font-semibold">
                        {n === 1 ? "1 match" : `Best of ${n}`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                <Field label="Maps" hint={bestOf > 1 ? "Used in order, then repeated." : "Every round uses the first."} error={bracketProblem ? "Pick at least one map." : undefined}>
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    value={maps}
                    onValueChange={(v) => setMaps(TDM_MAPS.filter((m) => v.includes(m)))}
                    className="flex-wrap justify-start"
                  >
                    {TDM_MAPS.map((m) => (
                      <ToggleGroupItem key={m} value={m} className={cn("h-10 gap-2 px-3 font-semibold", maps.includes(m) && MAP_STYLES[m].chip)}>
                        <span className={cn("size-2.5 rounded-full", MAP_STYLES[m].dot)} />
                        {MAP_LABELS[m].replace("TDM · ", "")}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </fieldset>
            </Section>
          )}

          {step === 2 && (
            <Section icon={<CalendarClock />} title="When" description="All rounds on one day · Indian time." tour="tdm-when">
              <div className="grid gap-5">
                <fieldset disabled={locked} className="grid gap-5 disabled:opacity-60 sm:grid-cols-2">
                  <Field label="Date">
                    <DatePickerButton value={date} onChange={setDate} className="h-11 w-full" isDisabled={(d) => d < todayInAppTz()} />
                  </Field>
                  <Field label="First match starts">
                    <TimeSelect value={startTime} onChange={setStartTime} />
                  </Field>
                  <Field label="Rooms at the same time" hint="More rooms = finishes sooner.">
                    <Stepper value={rooms} onChange={setRooms} min={1} max={4} suffix={rooms === 1 ? "room" : "rooms"} />
                  </Field>
                </fieldset>
                <Field label="Registration closes" optional error={errors.registrationClosesAt?.message}>
                  <Controller
                    control={control}
                    name="registrationClosesAt"
                    render={({ field }) => <DateTimeInput value={field.value} onChange={field.onChange} label="Registration closes" placeholder="When the first match starts" invalid={!!errors.registrationClosesAt} />}
                  />
                </Field>
              </div>
            </Section>
          )}

          {step === 3 && (
            <Section icon={<Coins />} title="BG coins" description="Paid to the champion's team leader when the final result is confirmed." tour="tdm-coins">
              <Field label="Coins for the champion" htmlFor="tdm-coins" error={errors.winCoins?.message}>
                <Controller control={control} name="winCoins" render={({ field }) => <WinCoinsInput id="tdm-coins" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.winCoins} />} />
              </Field>
            </Section>
          )}

          {step === LAST && (
            <Zone label="Review" bodyClassName="divide-y">
              <ReviewRow label="Name" value={title?.trim() || "—"} onEdit={() => setStep(0)} />
              {watch("prize")?.trim() && <ReviewRow label="Prize" value={watch("prize")!} onEdit={() => setStep(0)} />}
              <ReviewRow label="Poster" value={posterUrl ? "Added" : "None"} onEdit={() => setStep(0)} />
              <ReviewRow label="Bracket" value={`${teams} teams · ${bestOf === 1 ? "1 match" : `best of ${bestOf}`} · ${maps.map((m) => MAP_LABELS[m].replace("TDM · ", "")).join(", ") || "no maps"}`} bad={bracketProblem} onEdit={() => setStep(1)} />
              <ReviewRow
                label="When"
                value={`${formatDate(date)} · ${formatTime(startTime)} · ${rooms} ${rooms === 1 ? "room" : "rooms"}${finish ? ` · ends ~${formatTime(finish)}` : ""}`}
                bad={whenProblem}
                onEdit={() => setStep(2)}
              />
              <ReviewRow label="Sign-up closes" value={watch("registrationClosesAt") ? formatInstant(watch("registrationClosesAt")) : "When the first match starts"} onEdit={() => setStep(2)} />
              <ReviewRow label="Champion coins" value={coinsLabel(winCoins)} onEdit={() => setStep(3)} />
            </Zone>
          )}

          {/* phones: the bracket preview sits under the review */}
          {step === LAST && <div className="lg:hidden">{preview}</div>}

          <div data-tour="tdm-actions" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur lg:sticky lg:bottom-4 lg:z-10">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                <ArrowLeft /> Back
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link to={back}>Cancel</Link>
              </Button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {isDraft && step === LAST && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void save(false)}>
                  {saving === "draft" ? <Loader2 className="animate-spin" /> : <Save />} Save draft
                </Button>
              )}
              {existing && step < LAST && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void save(!isDraft)}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
                </Button>
              )}
              {step < LAST ? (
                <Button type="button" size="lg" onClick={() => void go(step + 1)} disabled={busy}>
                  Next<span className="hidden sm:inline">: {STEPS[step + 1]!.label}</span> <ArrowRight />
                </Button>
              ) : (
                <Button type="button" size="lg" disabled={busy} onClick={() => void save(true)} className="shadow-glow">
                  {saving === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
                  {isDraft ? (
                    <>
                      Publish<span className="hidden sm:inline"> & open registration</span>
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">{preview}</aside>
      </div>
    </>
  );
}

function ReviewRow({ label, value, onEdit, bad }: { label: string; value: string; onEdit: () => void; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
        <p className={cn("text-sm font-medium break-words", bad && "text-destructive")}>{value}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

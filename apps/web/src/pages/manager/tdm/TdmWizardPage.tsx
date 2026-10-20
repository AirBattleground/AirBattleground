import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertTriangle, ArrowLeft, CalendarClock, Coins, Crosshair, Crown, Image as ImageIcon, Loader2, Rocket, Save, Swords, Trophy, Type } from "lucide-react";
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
import { formatTime } from "@/features/manager/format";
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
import { Field, Section } from "@/features/tournaments/manager/components/form";
import { coinsLabel, WinCoinsInput } from "@/features/coins/components/WinCoinsInput";

const TOUR: TourStep[] = [
  { title: "Create a TDM battle", description: "A knockout of 2-team Team Deathmatch matches. Winners go through until one team is left." },
  { element: '[data-tour="tdm-basics"]', title: "Name it", description: "What teams see when they browse TDM battles." },
  { element: '[data-tour="tdm-poster"]', title: "Poster", description: "Add the battle's poster. Teams see it in the list and on the battle page." },
  { element: '[data-tour="tdm-bracket"]', title: "Bracket", description: "How many teams, best of how many matches, and which TDM maps." },
  { element: '[data-tour="tdm-when"]', title: "When", description: "The day and start time. Rounds follow one after another; more rooms at once finishes sooner." },
  { element: '[data-tour="tdm-coins"]', title: "BG coins", description: "The champion earns these coins. They go to the winning team's leader." },
  { element: '[data-tour="tdm-preview"]', title: "Check and publish", description: "The bracket and its times. Publish to open registration." },
];

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
  const { register, control, handleSubmit, setError, watch, formState } = form;
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

  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const save = (andPublish: boolean) =>
    handleSubmit(async (basics) => {
      if (!locked && !finish) {
        toast.error("The bracket doesn't finish before midnight", { description: "Start earlier, use more rooms at once, or play fewer matches per round." });
        return;
      }
      if (!locked && maps.length === 0) {
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
        }
        toast.error("Couldn't save the TDM battle", { description: errorMessage(err) });
      } finally {
        setSaving(null);
      }
    })();

  const back = existing ? `/manager/tournaments/${existing.id}` : "/manager/tdm";
  const busy = saving !== null;

  return (
    <>
      <BackLink to={back} />
      <PageHeader
        eyebrow={existing ? "Edit TDM battle" : "New TDM battle"}
        title={existing ? existing.title : title?.trim() || "Create a TDM battle"}
        description="2 teams per match. The winner goes through, round after round, until one champion is left."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Section icon={<Type />} title="Basics" description="What teams see when they browse TDM battles." tour="tdm-basics">
            <div className="grid gap-5">
              <Field label="Battle name" htmlFor="tdm-title" error={errors.title?.message}>
                <Input id="tdm-title" placeholder="e.g. Friday Night TDM Knockout" className="h-11 text-base" aria-invalid={!!errors.title || undefined} {...register("title")} />
              </Field>
              <Field label="Prize" optional htmlFor="tdm-prize" error={errors.prize?.message}>
                <Input id="tdm-prize" placeholder="e.g. ₹2,000 for the champion" className="h-11 text-base" {...register("prize")} />
              </Field>
              <Field label="Description" optional htmlFor="tdm-desc" error={errors.description?.message} hint="Rules, eligibility — anything teams should know.">
                <Textarea id="tdm-desc" rows={3} placeholder="e.g. 4v4. Be in the room 5 minutes before your match." {...register("description")} />
              </Field>
            </div>
          </Section>

          <BrandingImageCard
            title="Battle poster"
            icon={<ImageIcon />}
            description="Optional. Teams see it on the TDM battle page and lists. Square artwork looks best. It's saved with the battle."
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
          />

          <Section icon={<Swords />} title="Bracket" description={locked ? "The bracket is fixed once published." : "Teams, match count and maps."} tour="tdm-bracket">
            <fieldset disabled={locked} className="grid gap-6 disabled:opacity-60">
              <Field label="Number of teams" hint="Knockout brackets need 4, 8, 16, 32 or 64 teams.">
                <ToggleGroup type="single" variant="outline" value={String(teams)} onValueChange={(v) => v && setTeams(Number(v))} className="flex-wrap justify-start">
                  {TDM_TEAM_COUNTS.map((n) => (
                    <ToggleGroupItem key={n} value={String(n)} className="h-11 min-w-14 font-display text-lg font-bold">
                      {n}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field label="Matches per round" hint="Best of 3 = first to win 2 matches goes through.">
                <ToggleGroup type="single" variant="outline" value={String(bestOf)} onValueChange={(v) => v && setBestOf(Number(v))} className="flex-wrap justify-start">
                  {TDM_BEST_OF.map((n) => (
                    <ToggleGroupItem key={n} value={String(n)} className="h-11 px-4 font-semibold">
                      {n === 1 ? "1 match" : `Best of ${n}`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field label="Maps" hint={bestOf > 1 ? "Matches in a round use these maps in order, then repeat." : "Pick one or more; every round uses the first."}>
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

          <Section icon={<CalendarClock />} title="When" description="Rounds play one after another on the same day (Indian time)." tour="tdm-when">
            <div className="grid gap-5">
              <fieldset disabled={locked} className="grid gap-5 disabled:opacity-60 sm:grid-cols-2">
                <Field label="Date">
                  <DatePickerButton value={date} onChange={setDate} className="h-11 w-full" isDisabled={(d) => d < todayInAppTz()} />
                </Field>
                <Field label="First match starts">
                  <TimeSelect value={startTime} onChange={setStartTime} />
                </Field>
                <Field label="Matches at the same time" hint="How many rooms you can run at once.">
                  <Stepper value={rooms} onChange={setRooms} min={1} max={4} suffix={rooms === 1 ? "room" : "rooms"} />
                </Field>
              </fieldset>
              <Field label="Registration closes" optional error={errors.registrationClosesAt?.message} hint="Leave empty to close when the first match starts.">
                <Controller
                  control={control}
                  name="registrationClosesAt"
                  render={({ field }) => <DateTimeInput value={field.value} onChange={field.onChange} label="Registration closes" invalid={!!errors.registrationClosesAt} />}
                />
              </Field>
            </div>
          </Section>

          <Section icon={<Coins />} title="BG coins" description="The champion earns these. They go to the winning team's leader." tour="tdm-coins">
            <Field label="Coins for the champion" htmlFor="tdm-coins" error={errors.winCoins?.message} hint="Paid when the final's result is confirmed.">
              <Controller control={control} name="winCoins" render={({ field }) => <WinCoinsInput id="tdm-coins" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.winCoins} />} />
            </Field>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div data-tour="tdm-preview" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="bg-grid border-b bg-gradient-to-br from-primary/15 to-transparent p-5">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                <Crosshair className="size-3.5" /> TDM knockout
              </p>
              <p className="mt-1 truncate font-display text-2xl font-bold">{title?.trim() || "Untitled battle"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {teams} teams · {bestOf === 1 ? "1 match" : `best of ${bestOf}`} per round
              </p>
            </div>
            <div className="space-y-4 p-5">
              <ol className="space-y-2">
                {stages.map((s, i) => (
                  <li key={s.name} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg font-display text-sm font-bold", i === stages.length - 1 ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary")}>
                      {i === stages.length - 1 ? <Trophy className="size-4" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {s.groupCount === 1 ? "1 match-up" : `${s.groupCount} match-ups`} (M1{s.groupCount > 1 ? `–M${s.groupCount}` : ""})
                      </span>
                    </span>
                    {s.schedule && <span className="shrink-0 text-xs font-medium tabular-nums">{formatTime(s.schedule.windows[0]!.start)}</span>}
                  </li>
                ))}
                <li className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <Crown className="size-5 text-warning-foreground dark:text-warning" />
                  <span className="flex-1 font-semibold">Champion</span>
                  <span className="text-xs">{coinsLabel(winCoins)}</span>
                </li>
              </ol>
              {!locked &&
                (finish ? (
                  <p className="text-sm text-muted-foreground">
                    Final ends around <span className="font-semibold text-foreground">{formatTime(finish)}</span>.
                  </p>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> This runs past midnight. Start earlier, add rooms, or play fewer matches per round.
                  </p>
                ))}
              <Button type="button" size="lg" className="h-12 w-full text-base" disabled={busy} onClick={() => void save(true)}>
                {saving === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
                {existing && existing.status !== "DRAFT" ? "Save changes" : "Publish & open registration"}
              </Button>
              {(!existing || existing.status === "DRAFT") && (
                <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void save(false)}>
                  {saving === "draft" ? <Loader2 className="animate-spin" /> : <Save />} Save draft
                </Button>
              )}
              <Button asChild variant="ghost" className="w-full">
                <Link to={back}>Cancel</Link>
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

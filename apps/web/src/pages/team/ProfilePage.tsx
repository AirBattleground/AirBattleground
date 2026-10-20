import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, CalendarCheck, Check, Crown, Gamepad2, Hash, Hourglass, Languages, Loader2, Mail, Save, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { LANGUAGES, bgmiIdSchema, ignSchema } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { useTeamDashboard } from "@/features/team/api";
import { usePlayerProfile, useUpdateProfile } from "@/features/player/api";
import { applyApiError, Field, useBgmiHint } from "@/features/player/forms";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { LANGUAGE_META, useDateFormat, useLocale, useT } from "@/i18n/core";
import { common } from "@/i18n/common";
import { playerFormMsg } from "@/i18n/onboarding";
import { profileMsg } from "@/i18n/team";

const schema = z.object({ ign: ignSchema, bgmiId: z.union([bgmiIdSchema, z.literal("")]) });
type Values = z.infer<typeof schema>;

const Num = ({ v }: { v: number | undefined }) => (v === undefined ? <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" /> : <>{v}</>);

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-background/60 p-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-4">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

/** English / हिंदी / Hinglish — saved to the profile by setLang. */
function LanguageSetting() {
  const t = useT(profileMsg);
  const tc = useT(common);
  const { lang, setLang } = useLocale();
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:p-6" data-tour="profile-language">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Languages className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">{tc("language")}</h2>
          <p className="text-sm text-muted-foreground">{t("language_desc")}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label={tc("language")} className="grid grid-cols-3 gap-2 sm:flex">
        {LANGUAGES.map((l) => (
          <Button
            key={l}
            type="button"
            role="radio"
            aria-checked={l === lang}
            lang={LANGUAGE_META[l].htmlLang}
            variant={l === lang ? "default" : "outline"}
            onClick={() => setLang(l)}
            className={cn("min-w-24", l === lang && "shadow-glow")}
          >
            {l === lang && <Check />} {LANGUAGE_META[l].label}
          </Button>
        ))}
      </div>
    </section>
  );
}

export default function ProfilePage() {
  const t = useT(profileMsg);
  const tf = useT(playerFormMsg);
  const tc = useT(common);
  const fmt = useDateFormat();
  const bgmiHint = useBgmiHint();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_title"), description: t("tour_desc") },
      { element: '[data-tour="player-card"]', title: t("tour_card_title"), description: t("tour_card_desc"), side: "bottom" },
      { element: '[data-tour="player-form"]', title: t("tour_form_title"), description: t("tour_form_desc"), side: "top" },
      { element: '[data-tour="profile-language"]', title: t("tour_language_title"), description: t("tour_language_desc"), side: "top" },
      { element: '[data-tour="profile-team"]', title: t("tour_team_title"), description: t("tour_team_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.profile", steps);
  const { user, player, team, hasTeam } = usePlayerSession();
  const profile = usePlayerProfile();
  const update = useUpdateProfile();
  const dash = useTeamDashboard({ enabled: hasTeam });
  const p = profile.data;
  const ign = p?.ign ?? player?.ign ?? "";
  const bgmiId = p?.bgmiId ?? player?.bgmiId ?? "";
  const shownName = ign || user?.displayName || t("player");

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ign, bgmiId } });
  const { register, handleSubmit, setError, formState, reset } = form;
  useEffect(() => reset({ ign, bgmiId }), [ign, bgmiId, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ ign: v.ign, bgmiId: v.bgmiId });
      toast.success(t("saved_toast"));
    } catch (e) {
      const left = applyApiError(e, setError, ["ign", "bgmiId"], tc("something_wrong"));
      if (left) toast.error(tf("couldnt_save"), { description: left });
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={tc("my_profile")} description={t("desc")} className="mb-0" />

      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm" data-tour="player-card">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-grid opacity-70" />
        <div className="relative flex flex-col gap-5 p-5 pt-10 sm:flex-row sm:items-end sm:p-7 sm:pt-12">
          <PlayerAvatar name={shownName} url={player?.avatarUrl} size="xl" className="size-24 rounded-2xl shadow-glow ring-4 ring-card" />
          <div className="min-w-0 flex-1">
            {team && (
              <p className="font-display text-sm font-bold tracking-[0.3em] text-primary">
                [{team.tag}] {team.role === "LEADER" && <Crown className="inline size-4 -translate-y-px text-warning" />}
              </p>
            )}
            <h2 className="truncate font-display text-3xl font-bold sm:text-4xl">{shownName}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">{user?.displayName}</p>
          </div>
        </div>
        <div className="relative grid gap-3 border-t p-5 sm:grid-cols-3 sm:p-7">
          <Info icon={<Mail />} label={t("google_account")} value={player?.email ?? p?.email ?? "—"} />
          <Info icon={<Hash />} label={tf("bgmi_id")} value={bgmiId ? <span className="font-mono">{bgmiId}</span> : <span className="text-muted-foreground">{t("not_added")}</span>} />
          <Info icon={<CalendarCheck />} label={t("player_since")} value={p ? fmt(p.createdAt, "d MMM yyyy") : "—"} />
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-tour="player-form">
        <h2 className="font-display text-xl font-bold">{t("game_details")}</h2>
        <p className="text-sm text-muted-foreground">{t("game_details_desc")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="ign" label={tf("ign_label")} error={formState.errors.ign?.message}>
            <div className="relative">
              <Gamepad2 aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="ign" className="h-11 pl-9" aria-invalid={!!formState.errors.ign} {...register("ign")} />
            </div>
          </Field>
          <Field id="bgmiId" label={tf("bgmi_id")} error={formState.errors.bgmiId?.message} hint={bgmiHint}>
            <div className="relative">
              <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="bgmiId" inputMode="numeric" placeholder="5123456789" className="h-11 pl-9 font-mono tracking-wider" aria-invalid={!!formState.errors.bgmiId} {...register("bgmiId")} />
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={!formState.isDirty || formState.isSubmitting} className="w-full sm:w-auto">
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} {formState.isDirty ? t("save_changes") : t("saved")}
          </Button>
        </div>
      </form>

      <LanguageSetting />

      <section className="space-y-4" data-tour="profile-team">
        {team ? (
          <>
            <div className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-card p-5 shadow-sm sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <TeamAvatar name={team.name} tag={team.tag} size="lg" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.2em] text-primary uppercase">{t("your_team")}</p>
                  <p className="truncate font-display text-2xl leading-tight font-bold uppercase">{team.name}</p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {team.role === "LEADER" ? <Crown className="size-4 text-warning" /> : <Users className="size-4" />}
                    {team.role === "LEADER" ? t("you_lead") : t("member")}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link to="/team/my-team">
                  {t("open_my_team")} <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label={t("approved_upcoming")} value={<Num v={dash.data?.counts.approvedUpcoming} />} icon={<CalendarCheck />} tone="success" />
              <StatCard label={tc("status_pending")} value={<Num v={dash.data?.counts.pending} />} icon={<Hourglass />} tone="warning" />
              <StatCard label={t("matches_played")} value={<Num v={dash.data?.counts.totalPlayed} />} icon={<Trophy />} tone="brand" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed bg-card/60 p-5 sm:flex-row sm:items-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-bold">{t("no_team")}</p>
              <p className="text-sm text-muted-foreground">{t("no_team_desc")}</p>
            </div>
            <Button asChild>
              <Link to="/team">
                {t("get_into_team")} <ArrowRight />
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

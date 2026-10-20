import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Check, Crown, Gamepad2, Hash, Loader2, Mail, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { LANGUAGES, bgmiIdSchema, ignSchema } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { usePlayerProfile, useUpdateProfile } from "@/features/player/api";
import { applyApiError, Field, useBgmiHint } from "@/features/player/forms";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { LANGUAGE_META, useLocale, useT } from "@/i18n/core";
import { common } from "@/i18n/common";
import { playerFormMsg } from "@/i18n/onboarding";
import { profileMsg } from "@/i18n/team";

const schema = z.object({ ign: ignSchema, bgmiId: z.union([bgmiIdSchema, z.literal("")]) });
type Values = z.infer<typeof schema>;

const Label = ({ children }: { children: ReactNode }) => (
  <h2 className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{children}</h2>
);

/** English / हिंदी / Hinglish — saved to the profile by setLang. */
function LanguageSetting() {
  const tc = useT(common);
  const { lang, setLang } = useLocale();
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-tour="profile-language">
      <Label>{tc("language")}</Label>
      <div role="radiogroup" aria-label={tc("language")} className="grid grid-cols-3 gap-2">
        {LANGUAGES.map((l) => (
          <Button
            key={l}
            type="button"
            role="radio"
            aria-checked={l === lang}
            lang={LANGUAGE_META[l].htmlLang}
            variant={l === lang ? "default" : "outline"}
            onClick={() => setLang(l)}
            className="h-10 px-2"
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
  const { user, player, team } = usePlayerSession();
  const profile = usePlayerProfile();
  const update = useUpdateProfile();
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
      <PageHeader eyebrow={t("eyebrow")} title={tc("my_profile")} className="mb-0" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section className="rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center gap-4 p-4 sm:p-5" data-tour="player-card">
            <PlayerAvatar name={shownName} url={player?.avatarUrl} size="xl" className="size-16 rounded-2xl shadow-glow" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-display text-2xl leading-tight font-bold sm:text-3xl">
                <span className="truncate">{shownName}</span>
                {team && <span className="shrink-0 font-mono text-sm tracking-[0.2em] text-primary">[{team.tag}]</span>}
              </p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={t("google_account")}>
                <Mail className="size-3.5 shrink-0" /> <span className="truncate">{player?.email ?? p?.email ?? "—"}</span>
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} noValidate className="border-t p-4 sm:p-5" data-tour="player-form">
            <Label>{t("game_details")}</Label>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
            <div className="mt-4 flex justify-end">
              <Button type="submit" disabled={!formState.isDirty || formState.isSubmitting} className="w-full sm:w-auto">
                {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} {formState.isDirty ? t("save_changes") : t("saved")}
              </Button>
            </div>
          </form>
        </section>

        <div className="space-y-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-tour="profile-team">
            <Label>{t("your_team")}</Label>
            {team ? (
              <Link to="/team/my-team" className="group -m-1 flex items-center gap-3 rounded-xl p-1 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <TeamAvatar name={team.name} tag={team.tag} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg leading-tight font-bold uppercase">{team.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {team.role === "LEADER" ? <Crown className="size-3.5 text-warning" /> : <Users className="size-3.5" />}
                    {team.role === "LEADER" ? t("you_lead") : t("member")}
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-label={t("open_my_team")} />
              </Link>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t("no_team")}</p>
                <Button asChild className="w-full">
                  <Link to="/team/my-team">
                    {t("get_into_team")} <ArrowRight />
                  </Link>
                </Button>
              </>
            )}
          </section>

          <LanguageSetting />
        </div>
      </div>
    </div>
  );
}

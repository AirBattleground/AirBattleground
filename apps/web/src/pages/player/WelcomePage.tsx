import { useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { ArrowRight, Gamepad2, Hash, Loader2, LogOut } from "lucide-react";
import { bgmiIdSchema, ignSchema } from "@7xen/shared";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { toast } from "sonner";
import { homeFor, useAuth } from "@/lib/auth";
import { loginWithNext, safeNext } from "@/lib/guards";
import { markExplicitLogout } from "@/lib/session";
import { useUpdateProfile } from "@/features/player/api";
import { applyApiError, Field, useBgmiHint } from "@/features/player/forms";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { PlayerScene, SceneEyebrow } from "@/features/player/components/PlayerScene";
import { LanguageChips } from "@/i18n/LanguageSwitch";
import { useT } from "@/i18n/core";
import { common } from "@/i18n/common";
import { playerFormMsg, welcomeMsg } from "@/i18n/onboarding";

const schema = z.object({ ign: ignSchema, bgmiId: z.union([bgmiIdSchema, z.literal("")]) });
type Values = z.infer<typeof schema>;

export default function WelcomePage() {
  const t = useT(welcomeMsg);
  const tf = useT(playerFormMsg);
  const tc = useT(common);
  const bgmiHint = useBgmiHint();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_title"), description: t("tour_desc") },
      { element: '[data-tour="welcome-ign"]', title: t("tour_ign_title"), description: t("tour_ign_desc"), side: "bottom" },
      { element: '[data-tour="welcome-bgmi"]', title: t("tour_bgmi_title"), description: t("tour_bgmi_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("player.welcome", steps);
  const { user, isLoading, refresh, logout } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const update = useUpdateProfile();
  const p = user?.player;

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ign: p?.ign ?? "", bgmiId: p?.bgmiId ?? "" } });
  const { register, handleSubmit, setError, formState } = form;
  const { errors, isSubmitting } = formState;

  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to={loginWithNext("/welcome")} replace />;
  if (user.role !== "PLAYER" || (!p?.needsOnboarding && !isSubmitting)) {
    return <Navigate to={(user.role === "PLAYER" && safeNext(user, params.get("next"))) || homeFor(user)} replace />;
  }

  const onSubmit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ ign: v.ign, ...(v.bgmiId ? { bgmiId: v.bgmiId } : {}) });
      const u = await refresh();
      toast.success(t("toast_welcome", { name: v.ign }), { description: t("toast_welcome_desc") });
      navigate((u && safeNext(u, params.get("next"))) || "/team", { replace: true });
    } catch (e) {
      const left = applyApiError(e, setError, ["ign", "bgmiId"], tc("something_wrong"));
      if (left) toast.error(tf("couldnt_save"), { description: left });
    }
  });

  const signOut = async () => {
    markExplicitLogout();
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <PlayerScene>
      <LanguageChips className="mb-5" />
      <SceneEyebrow>{t("eyebrow")}</SceneEyebrow>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
        <div className="flex items-center gap-3">
          <PlayerAvatar name={user.displayName} url={p?.avatarUrl} size="lg" className="shadow-glow" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">{t("signed_in_as", { who: p?.email ?? user.displayName })}</p>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{t("intro")}</p>

        <form onSubmit={onSubmit} noValidate className="mt-7 space-y-5">
          <div data-tour="welcome-ign">
            <Field id="ign" label={tf("ign_label")} error={errors.ign?.message} hint={t("ign_hint")}>
              <div className="relative">
                <Gamepad2 aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="ign" autoFocus autoComplete="nickname" placeholder={t("ign_placeholder")} className="h-12 rounded-xl bg-background/60 pl-10 text-base" aria-invalid={!!errors.ign} {...register("ign")} />
              </div>
            </Field>
          </div>
          <div data-tour="welcome-bgmi">
            <Field
              id="bgmiId"
              label={
                <>
                  {tf("bgmi_id")} <span className="font-normal text-muted-foreground">{t("optional_now")}</span>
                </>
              }
              error={errors.bgmiId?.message}
              hint={`${t("bgmi_needed")} ${bgmiHint}`}
            >
              <div className="relative">
                <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bgmiId" inputMode="numeric" placeholder="5123456789" className="h-12 rounded-xl bg-background/60 pl-10 font-mono tracking-wider" aria-invalid={!!errors.bgmiId} {...register("bgmiId")} />
              </div>
            </Field>
          </div>
          <Button type="submit" size="lg" disabled={isSubmitting} className="group h-12 w-full justify-between rounded-xl px-5 text-base font-semibold shadow-glow">
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> {tf("saving")}
              </span>
            ) : (
              <>
                {t("lets_go")} <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </form>
        <Button variant="ghost" size="sm" className="mt-6 text-muted-foreground" onClick={() => void signOut()}>
          <LogOut /> {t("not_you")}
        </Button>
      </motion.div>
    </PlayerScene>
  );
}

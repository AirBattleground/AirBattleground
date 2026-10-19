import { useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, FlaskConical, Loader2, Lock, Mail, ShieldCheck, User, UserCog } from "lucide-react";
import { ApiError, devLoginSchema, loginSchema, type DevLoginInput, type LoginInput } from "@7xen/shared";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { destinationFor } from "@/lib/guards";
import { useAuthConfig } from "@/features/player/api";
import { GoogleSignInButton } from "@/features/player/components/GoogleSignInButton";
import { WelcomeHeading } from "./WelcomeHeading";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import markUrl from "@/assets/brand/airbattleground-mark.webp";

const STEPS: TourStep[] = [
  { title: "Sign in", description: "Players sign in with Google — no password to remember. Organisers use their username." },
  { element: '[data-tour="player-signin"]', title: "Players", description: "Tap Continue with Google. The first time, we create your player account and ask for your in-game name.", side: "bottom" },
  { element: '[data-tour="organiser-toggle"]', title: "Organisers", description: "Scrim managers sign in here with the username and password the admin gave them.", side: "top" },
];

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </motion.div>
  );
}

/** Email-only sign-in for local testing (shown only when the API has PLAYER_DEV_LOGIN=1). */
function DevSignIn({ onDone }: { onDone: (input: DevLoginInput) => Promise<void> }) {
  const form = useForm<DevLoginInput>({ resolver: zodResolver(devLoginSchema), defaultValues: { email: "", name: "" } });
  const { register, handleSubmit, formState, setError } = form;
  const submit = handleSubmit(async (v) => {
    try {
      await onDone({ email: v.email, name: v.name?.trim() || undefined });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError("email", { message: err?.fields?.email ?? errorText(e) });
    }
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-2.5 rounded-2xl border border-dashed border-warning/40 bg-warning/5 p-3.5" data-tour="dev-signin">
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-warning uppercase">
        <FlaskConical className="size-3.5" /> Dev sign-in
      </p>
      <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr]">
        <div className="relative">
          <Mail aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="email" placeholder="player@7xen.dev" autoComplete="email" aria-label="Email" aria-invalid={!!formState.errors.email} className="h-10 rounded-xl bg-background/60 pl-9" {...register("email")} />
        </div>
        <Input placeholder="Name (optional)" aria-label="Name" className="h-10 rounded-xl bg-background/60" {...register("name")} />
      </div>
      {formState.errors.email && <p className="text-xs font-medium text-destructive">{formState.errors.email.message}</p>}
      <Button type="submit" variant="outline" className="h-10 w-full rounded-xl" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <ArrowRight />} Sign in as this player
      </Button>
    </form>
  );
}

/** Players: Google (or dev sign-in). */
function PlayerSignIn({ onSignedIn }: { onSignedIn: (p: Promise<unknown>) => Promise<void> }) {
  const config = useAuthConfig();
  const { loginWithGoogle, devLogin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = config.data;

  const google = async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSignedIn(loginWithGoogle(credential));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-tour="player-signin">
      {error && <ErrorBanner message={error} />}
      {config.isLoading ? (
        <div className="h-11 animate-pulse rounded-full bg-muted" />
      ) : c?.googleClientId ? (
        <GoogleSignInButton clientId={c.googleClientId} onCredential={google} busy={busy} />
      ) : !c?.devLogin ? (
        <div className="flex items-start gap-3 rounded-2xl border bg-card/70 p-4 text-sm">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <p>
            <span className="block font-semibold">Player sign-in isn't set up yet</span>
            <span className="text-muted-foreground">
              {config.isError ? "We couldn't reach the server. Refresh the page in a moment." : "It opens very soon. Organisers can still sign in with their username below."}
            </span>
          </p>
        </div>
      ) : null}
      {c?.devLogin && <DevSignIn onDone={(v) => onSignedIn(devLogin(v))} />}
      {(c?.googleClientId || c?.devLogin) && (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          New here? Just continue — we'll create your player account. <span className="text-foreground">No passwords.</span>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  usePageTour("auth.login", STEPS);
  const { user, isLoading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? (location.state as { from?: unknown } | null)?.from;
  const [organiser, setOrganiser] = useState(() => params.get("as") === "organiser" || (typeof next === "string" && next.startsWith("/manager")));
  const [signingIn, setSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: "", password: "" } });
  const { register, handleSubmit, setError, setFocus, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const u = await login(values);
      navigate(destinationFor(u, next), { replace: true });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.fields) {
        for (const [k, message] of Object.entries(err.fields)) {
          if (k === "username" || k === "password") setError(k, { message });
        }
      }
      setFormError(err?.message ?? "Something went wrong. Please try again.");
      setFocus("password");
    }
  });

  const onPlayerSignedIn = async (p: Promise<unknown>) => {
    setSigningIn(true);
    try {
      const u = (await p) as Parameters<typeof destinationFor>[0];
      navigate(destinationFor(u, next), { replace: true });
    } finally {
      setSigningIn(false);
    }
  };

  if (!isLoading && user && !isSubmitting && !signingIn) return <Navigate to={destinationFor(user, next)} replace />;

  return (
    <div className="bg-background">
      <LoginScene
        header={
          <>
            {/* Header always sits over the dark map artwork, so the light-text logo works in both themes. */}
            <picture className="block drop-shadow-[0_2px_12px_rgb(0_0_0/0.5)]">
              <source media="(max-width: 850px)" srcSet={markUrl} />
              <img src={wordmarkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink h-12 w-auto max-[850px]:h-14 sm:h-14 min-[1200px]:h-16" />
            </picture>
            <ThemeToggle className="max-[850px]:border-white/15 max-[850px]:bg-black/30 max-[850px]:text-white/80 max-[850px]:backdrop-blur max-[850px]:hover:text-white" />
          </>
        }
        footer={
          <>
            <span>© {new Date().getFullYear()} AirBattleground</span>
            <span>Made for the game. Built for the players.</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary shadow-glow" /> Scrims · Tournaments
            </span>
          </>
        }
      >
        <p className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.25em] text-primary uppercase">
          <span className="h-px w-6 bg-primary" /> Player access
        </p>
        <WelcomeHeading />
        <p className="mt-3 text-sm text-muted-foreground">Your next match starts with your squad.</p>

        <AnimatePresence mode="wait" initial={false}>
          {!organiser ? (
            <motion.div key="player" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="mt-8">
              <PlayerSignIn onSignedIn={onPlayerSignedIn} />
            </motion.div>
          ) : (
        <motion.form key="organiser" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserCog className="size-4 text-primary" /> Organiser sign-in
          </p>
          {formError && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{formError}</span>
            </motion.div>
          )}

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <User aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                placeholder="your-username"
                className="h-12 rounded-xl bg-background/60 pl-10"
                aria-invalid={!!errors.username}
                aria-describedby={errors.username ? "username-error" : undefined}
                {...register("username")}
              />
            </div>
            {errors.username && (
              <p id="username-error" className="text-xs font-medium text-destructive">
                {errors.username.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="h-12 rounded-xl bg-background/60 pr-12 pl-10"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="text-xs font-medium text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" size="lg" disabled={isSubmitting} className="group h-12 w-full justify-between rounded-xl px-5 text-base font-semibold shadow-glow">
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Signing in…
              </span>
            ) : (
              <>
                Enter the arena <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </motion.form>
          )}
        </AnimatePresence>

        <div className="my-7 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {organiser ? "Playing?" : "Running scrims?"}
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button
          type="button"
          variant="ghost"
          className="w-full rounded-xl text-muted-foreground hover:text-foreground"
          onClick={() => setOrganiser((o) => !o)}
          data-tour="organiser-toggle"
        >
          {organiser ? (
            <>
              <ArrowLeft /> Player? Continue with Google
            </>
          ) : (
            <>
              <UserCog /> Organiser? Sign in with your username
            </>
          )}
        </Button>

        <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Your account. Your game.
        </p>
      </LoginScene>
    </div>
  );
}

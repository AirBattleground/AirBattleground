import { lazy, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, FlaskConical, Loader2, Mail, Radio, ShieldCheck } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { ApiError, devLoginSchema, type DevLoginInput, type SessionUser } from "@7xen/shared";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { dismissSplash } from "@/lib/splash";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { destinationFor } from "@/lib/guards";
import { useAuthConfig } from "@/features/player/api";
import { GoogleSignInButton } from "@/features/player/components/GoogleSignInButton";
import { SkinSwitch } from "@/lib/skin";
import { WelcomeHeading } from "./WelcomeHeading";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import markUrl from "@/assets/brand/airbattleground-mark.webp";

const LuxLoginPage = lazy(() => import("@/skins/lux/pages/LuxLoginPage"));

const STEPS: TourStep[] = [
  { title: "Sign in", description: "Everyone signs in with Google — players, organisers and admins. No password to remember." },
  { element: '[data-tour="signin"]', title: "Continue with Google", description: "Tap the button and pick your Google account. New players get an account and choose an in-game name; invited organisers land on their dashboard.", side: "bottom" },
];

/** The admin console is a separate app; the API set its cookie on the sign-in response. */
const ADMIN_CONSOLE = "/admin-ui/";

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

export function ErrorBanner({ message }: { message: string }) {
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
export function DevSignIn({ onDone }: { onDone: (input: DevLoginInput) => Promise<void> }) {
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
          <Input type="email" placeholder="you@example.com" autoComplete="email" aria-label="Email" aria-invalid={!!formState.errors.email} className="h-10 rounded-xl bg-background/60 pl-9" {...register("email")} />
        </div>
        <Input placeholder="Name (optional)" aria-label="Name" className="h-10 rounded-xl bg-background/60" {...register("name")} />
      </div>
      {formState.errors.email && <p className="text-xs font-medium text-destructive">{formState.errors.email.message}</p>}
      <Button type="submit" variant="outline" className="h-10 w-full rounded-xl" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <ArrowRight />} Sign in with this email
      </Button>
    </form>
  );
}

/** Google for everyone (plus the dev email sign-in when the API allows it). */
export function SignIn({ onSignedIn }: { onSignedIn: (p: Promise<SessionUser>) => Promise<void> }) {
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
    <div className="space-y-4" data-tour="signin">
      {error && <ErrorBanner message={error} />}
      {config.isLoading ? (
        <div className="h-11 animate-pulse rounded-full bg-muted" />
      ) : c?.googleClientId ? (
        <GoogleSignInButton clientId={c.googleClientId} onCredential={google} busy={busy} />
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border bg-card/70 p-4 text-sm">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <p>
            <span className="block font-semibold">Sign-in isn't set up yet</span>
            <span className="text-muted-foreground">
              {config.isError ? "We couldn't reach the server. Refresh the page in a moment." : "It opens very soon. Please check back a little later."}
            </span>
          </p>
        </div>
      )}
      {c?.devLogin && <DevSignIn onDone={(v) => onSignedIn(devLogin(v)).then(() => undefined)} />}
      {c?.googleClientId && (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          New player? Just continue — we'll create your account. <span className="text-foreground">No passwords.</span>
        </p>
      )}
    </div>
  );
}

export type OnSignedIn = (p: Promise<SessionUser>) => Promise<void>;

/** Visitors can watch broadcasts without an account (/watch). Shows a live count when something is on. */
export function WatchLiveLink({ className }: { className?: string }) {
  const live = useLiveBroadcasts().data?.length ?? 0;
  return (
    <Link
      to="/watch"
      className={cn(
        "group flex items-center gap-3 rounded-2xl border bg-card/60 px-4 py-3 text-sm backdrop-blur transition-colors outline-none hover:border-destructive/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <Radio className="size-4" />
        {live > 0 && <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{live}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{live > 0 ? `${live} ${live === 1 ? "match" : "matches"} live now` : "Watch live matches"}</span>
        <span className="block text-xs text-muted-foreground">No sign-in needed</span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * Everything the sign-in screen does besides drawing it (shared by both site looks): page tour, splash hand-over,
 * redirects for signed-in users and admins, and the post-sign-in navigation. `blocker` is what to render instead of the
 * form (a redirect or the admin hand-off loader), else null.
 */
export function useLoginFlow(): { onSignedIn: OnSignedIn; blocker: ReactNode | null } {
  usePageTour("auth.login", STEPS);
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? (location.state as { from?: unknown } | null)?.from;
  const [signingIn, setSigningIn] = useState(false);
  const isAdmin = user?.role === "ADMIN";

  // hand over from the boot splash as soon as the sign-in check has answered (the page itself is already in the bundle)
  useEffect(() => {
    if (!isLoading) dismissSplash();
  }, [isLoading]);

  useEffect(() => {
    if (isAdmin) window.location.assign(ADMIN_CONSOLE);
  }, [isAdmin]);

  const onSignedIn = async (p: Promise<SessionUser>) => {
    setSigningIn(true);
    try {
      const u = await p;
      if (u.role === "ADMIN") {
        window.location.assign(ADMIN_CONSOLE);
        return; // keep the busy state while the console loads
      }
      navigate(destinationFor(u, next), { replace: true });
      setSigningIn(false);
    } catch (e) {
      setSigningIn(false);
      throw e;
    }
  };

  let blocker: ReactNode | null = null;
  if (isAdmin) blocker = <FullPageLoader />;
  else if (!isLoading && user && !signingIn) blocker = <Navigate to={destinationFor(user, next)} replace />;
  return { onSignedIn, blocker };
}

export default function LoginPage() {
  const { onSignedIn, blocker } = useLoginFlow();
  if (blocker) return blocker;
  return <SkinSwitch teal={<TealLogin onSignedIn={onSignedIn} />} lux={<LuxLoginPage onSignedIn={onSignedIn} />} />;
}

/** Teal Battle sign-in screen. */
function TealLogin({ onSignedIn }: { onSignedIn: OnSignedIn }) {
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
          <span className="h-px w-6 bg-primary" /> Sign in
        </p>
        <WelcomeHeading />
        <p className="mt-3 text-sm text-muted-foreground">Players, organisers and admins — one sign-in.</p>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-8">
          <SignIn onSignedIn={onSignedIn} />
        </motion.div>

        <ul className="mt-7 grid gap-2 text-xs text-muted-foreground">
          <li className="flex items-center gap-2"><ArrowRight className="size-3.5 text-primary" /> Players go to their team</li>
          <li className="flex items-center gap-2"><ArrowRight className="size-3.5 text-primary" /> Invited organisers go to their dashboard</li>
        </ul>

        <WatchLiveLink className="mt-6" />

        <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Your account. Your game.
        </p>
      </LoginScene>
    </div>
  );
}

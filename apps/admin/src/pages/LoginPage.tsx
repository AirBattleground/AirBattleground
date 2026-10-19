import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import { Logo } from "@7xen/ui/components/brand/logo";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { useAuth, useAuthConfig } from "@/lib/auth";

const TOUR: TourStep[] = [
  { title: "Admin sign-in", description: "The Admin Console opens only for the owner's Google account." },
  { element: '[data-tour="admin-signin"]', title: "Continue with Google", description: "Pick the admin Google account. Anyone else is sent back to the main app.", side: "bottom" },
];

/** The main app's sign-in page (players and organisers). */
const MAIN_LOGIN = "/login";

type LoginError = { message: string; notAdmin?: boolean };

function friendlyError(e: unknown): LoginError {
  if (!(e instanceof ApiError)) return { message: "Something went wrong. Please try again." };
  if (e.status === 403 || e.code === "FORBIDDEN") return { message: "This Google account isn't the admin account.", notAdmin: true };
  return { message: e.message };
}

export default function LoginPage() {
  usePageTour("admin.login", TOUR);
  const { user, isLoading, loginWithGoogle } = useAuth();
  const config = useAuthConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const dest = from && from !== "/login" ? from : "/";
  const [error, setError] = useState<LoginError | null>(null);
  const [busy, setBusy] = useState(false);

  // already signed in (e.g. via Google on the main app, which also sets the admin cookie) → straight in
  if (isLoading) return <FullPageLoader />;
  if (user?.role === "ADMIN") return <Navigate to={dest} replace />;

  const google = async (credential: string) => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle(credential);
      navigate(dest, { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const c = config.data;

  return (
    <div className="bg-background">
      <LoginScene
        header={
          <>
            <Logo subtitle="Admin Console" className="drop-shadow-[0_2px_12px_rgb(0_0_0/0.45)] [&_.text-muted-foreground]:text-white/70 [&>span>span:first-child]:text-white" />
            <ThemeToggle className="max-[850px]:border-white/15 max-[850px]:bg-black/30 max-[850px]:text-white/80 max-[850px]:backdrop-blur max-[850px]:hover:text-white" />
          </>
        }
        footer={
          <>
            <span>© {new Date().getFullYear()} AirBattleground</span>
            <span>Owners only</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary shadow-glow" /> Admin Console
            </span>
          </>
        }
      >
        <p className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.25em] text-primary uppercase">
          <span className="h-px w-6 bg-primary" /> Admin access
        </p>
        <h1 className="font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl">Command center.</h1>
        <p className="mt-3 text-sm text-muted-foreground">Managers, players, tournaments and the screenshot reader — all in one place.</p>

        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="err"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto", x: [0, -6, 6, -4, 4, 0] }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35 }}
              className="overflow-hidden"
            >
              <div className="mt-6 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {error.message}
                  {error.notAdmin && (
                    <>
                      {" "}
                      <a href={MAIN_LOGIN} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
                        Go to the main app <ArrowRight className="size-3.5" />
                      </a>
                    </>
                  )}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 space-y-4" data-tour="admin-signin">
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
                  {config.isError ? "We couldn't reach the server. Refresh the page in a moment." : "Google sign-in needs to be configured on the server first."}
                </span>
              </p>
            </div>
          )}
        </div>

        <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>
            Player or organiser?{" "}
            <a href={MAIN_LOGIN} className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in on the main app
            </a>
          </span>
        </p>
      </LoginScene>
    </div>
  );
}

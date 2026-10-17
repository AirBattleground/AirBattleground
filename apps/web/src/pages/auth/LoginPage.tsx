import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { ApiError, loginSchema, type LoginInput, type SessionUser } from "@7xen/shared";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import { Logo } from "@7xen/ui/components/brand/logo";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { homeFor, useAuth } from "@/lib/auth";

/** Only honour a "from" path that belongs to this user's area. */
function destinationFor(user: SessionUser, from: unknown) {
  const home = homeFor(user);
  if (typeof from === "string" && (from === home || from.startsWith(home + "/"))) return from;
  return home;
}

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: unknown } | null)?.from;
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: "", password: "" } });
  const { register, handleSubmit, setError, setFocus, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const u = await login(values);
      navigate(destinationFor(u, from), { replace: true });
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

  if (!isLoading && user && !isSubmitting) return <Navigate to={destinationFor(user, from)} replace />;

  return (
    <div className="bg-background">
      <LoginScene
        header={
          <>
            <Logo subtitle="Battlegrounds Scrims" className="drop-shadow-[0_2px_12px_rgb(0_0_0/0.45)] [&_.text-muted-foreground]:text-white/70 [&>span>span:first-child]:text-white" />
            <ThemeToggle className="max-[850px]:border-white/15 max-[850px]:bg-black/30 max-[850px]:text-white/80 max-[850px]:backdrop-blur max-[850px]:hover:text-white" />
          </>
        }
        footer={
          <>
            <span>© {new Date().getFullYear()} 7XEN</span>
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
        <h1 className="font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl">Welcome back.</h1>
        <p className="mt-3 text-sm text-muted-foreground">Your next match starts with your squad.</p>

        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
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
        </form>

        <div className="my-7 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          New to the squad?
          <span className="h-px flex-1 bg-border" />
        </div>
        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          Ask your <span className="font-medium text-foreground">scrim manager</span> or the <span className="font-medium text-foreground">7xen admin</span> to register your team.
        </p>

        <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Your account. Your game.
        </p>
      </LoginScene>
    </div>
  );
}

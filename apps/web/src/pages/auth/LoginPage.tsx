import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, ListChecks, Loader2, Lock, MousePointerClick, ShieldCheck, User, Zap } from "lucide-react";
import { ApiError, loginSchema, type LoginInput, type SessionUser } from "@7xen/shared";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Logo } from "@7xen/ui/components/brand/logo";
import { Pill, SlotChip } from "@7xen/ui/components/brand/status";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { homeFor, useAuth } from "@/lib/auth";

const FEATURES = [
  { icon: MousePointerClick, title: "Register for scrims in one tap", text: "Pick a day, pick a scrim, you're in the queue." },
  { icon: Zap, title: "Instant slot allotment", text: "Approved? Your slot number is ready right away." },
  { icon: ListChecks, title: "Every match, organised", text: "Maps, times and slots — all in one place." },
];

const EASE = [0.16, 1, 0.3, 1] as const;
const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const rise: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } };

/** Only honour a "from" path that belongs to this user's area. */
function destinationFor(user: SessionUser, from: unknown) {
  const home = homeFor(user);
  if (typeof from === "string" && (from === home || from.startsWith(home + "/"))) return from;
  return home;
}

/** Decorative lobby: slots fill up one by one, on a loop. */
function LobbyHud() {
  const slots = Array.from({ length: 16 }, (_, i) => i + 1);
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="clip-angle bg-gradient-to-br from-primary/60 via-border to-primary/20 p-px">
        <div className="clip-angle bg-card/85 p-5 backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Tonight's lobby</p>
              <p className="font-display text-xl font-bold">Erangel · 21:00 IST</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Filling
            </span>
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {slots.map((n, i) => {
              const start = 0.04 + i * 0.045;
              return (
                <div key={n} className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-muted/50">
                  <motion.span
                    className="absolute inset-0 bg-gradient-to-b from-primary to-brand-700"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0, 1, 1, 0] }}
                    transition={{ duration: 8, times: [0, start, start + 0.03, 0.92, 1], repeat: Infinity, ease: "easeOut" }}
                  />
                  <span className="relative font-display text-xs font-bold text-foreground/80 mix-blend-normal">{String(n).padStart(2, "0")}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>Slots 1–16</span>
            <span className="font-mono">auto-allotted</span>
          </div>
        </div>
      </div>
      <SlotChip slot={7} size="lg" className="absolute -top-8 -right-4 animate-float sm:-right-8" />
      <div className="absolute -bottom-6 -left-4 animate-float [animation-delay:-3s] sm:-left-8">
        <div className="flex items-center gap-2 rounded-xl border bg-popover/95 px-3 py-2 text-sm shadow-glow backdrop-blur">
          <ShieldCheck className="size-4 text-success" />
          <span className="font-medium">Team approved</span>
          <Pill tone="success">Slot #07</Pill>
        </div>
      </div>
    </div>
  );
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
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex min-h-dvh flex-col bg-background lg:flex-row">
        <ThemeToggle className="absolute top-4 right-4 z-20 bg-card/70 backdrop-blur sm:top-6 sm:right-6" />

        {/* Hero */}
        <section className="relative isolate overflow-hidden border-b lg:flex lg:w-[56%] lg:flex-col lg:border-r lg:border-b-0">
          <AnimatedBackground intensity="hero" />
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="relative flex flex-1 flex-col justify-between gap-10 px-6 pt-6 pb-8 sm:px-10 lg:px-14 lg:py-10 xl:px-20"
          >
            <motion.div variants={rise}>
              <Logo subtitle="Battlegrounds Scrims" className="[&_svg]:size-11 [&>span>span:first-child]:text-3xl" />
            </motion.div>

            <div className="max-w-xl">
              <motion.p variants={rise} className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                <span className="size-1.5 rounded-full bg-primary shadow-glow" /> PUBG · BGMI
              </motion.p>
              <motion.h1 variants={rise} className="font-display text-4xl leading-[1.02] font-bold sm:text-5xl xl:text-6xl">
                Compete. <br className="hidden sm:block" />
                Get your slot. <br />
                <span className="text-gradient-brand">Drop in.</span>
              </motion.h1>
              <motion.p variants={rise} className="mt-4 max-w-md text-base text-muted-foreground sm:text-lg">
                The scrim portal for teams and managers. No spreadsheets, no DMs — just matches.
              </motion.p>

              <motion.ul variants={stagger} className="mt-8 hidden gap-4 sm:grid">
                {FEATURES.map((f) => (
                  <motion.li key={f.title} variants={rise} className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                      <f.icon className="size-5" />
                    </span>
                    <span>
                      <span className="block font-display text-lg font-bold leading-tight">{f.title}</span>
                      <span className="block text-sm text-muted-foreground">{f.text}</span>
                    </span>
                  </motion.li>
                ))}
              </motion.ul>
            </div>

            <motion.div variants={rise} className="hidden px-8 pt-6 pb-8 lg:block">
              <LobbyHud />
            </motion.div>
          </motion.div>
        </section>

        {/* Sign-in */}
        <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
            className="w-full max-w-sm"
          >
            <div className="relative rounded-2xl border bg-card/90 p-6 shadow-xl backdrop-blur-xl sm:p-8">
              <div aria-hidden className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
              <h2 className="font-display text-3xl font-bold">Sign in</h2>
              <p className="mt-1 text-sm text-muted-foreground">Welcome back. Your squad is waiting.</p>

              <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
                {formError && (
                  <motion.div
                    role="alert"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{formError}</span>
                  </motion.div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <User aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="username"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      placeholder="your-username"
                      className="h-11 pl-9"
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

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-11 pr-11 pl-9"
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? "password-error" : undefined}
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

                <Button type="submit" size="lg" disabled={isSubmitting} className="group h-11 w-full text-base font-semibold shadow-glow">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    <>
                      Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>

              <p className="mt-6 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-center text-xs leading-relaxed text-muted-foreground">
                No account yet? Ask your scrim manager or the 7xen admin to register your team.
              </p>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} 7XEN · Built for competitive squads</p>
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  );
}

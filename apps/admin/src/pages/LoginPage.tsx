import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import type { z } from "zod";
import { AlertCircle, ArrowRight, Lock, ShieldCheck, User } from "lucide-react";
import { ApiError, loginSchema, type LoginInput } from "@7xen/shared";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import { Logo } from "@7xen/ui/components/brand/logo";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@7xen/ui/components/ui/form";
import { Input } from "@7xen/ui/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/lib/auth";

function friendlyError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Please try again.";
  if (e.status === 401 || e.code === "UNAUTHENTICATED") return e.message || "Wrong username or password.";
  if (e.code === "FORBIDDEN") return "This account can't open the Admin Console. Managers and teams sign in on the main portal.";
  return e.message;
}

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const dest = from && from !== "/login" ? from : "/";
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.input<typeof loginSchema>, unknown, LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  if (isLoading) return <FullPageLoader />;
  if (user?.role === "ADMIN") return <Navigate to={dest} replace />;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      navigate(dest, { replace: true });
    } catch (e) {
      setError(friendlyError(e));
      form.setValue("password", "");
      form.setFocus("password");
    }
  });
  const busy = form.formState.isSubmitting;

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
            <span>© {new Date().getFullYear()} 7XEN</span>
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
        <p className="mt-3 text-sm text-muted-foreground">Logins, teams, tournaments and the screenshot reader — all in one place.</p>

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
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Form {...form}>
          <form onSubmit={submit} className="mt-8 grid gap-5" noValidate>
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <div className="relative">
                    <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <FormControl>
                      <Input {...field} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="admin" className="h-12 rounded-xl bg-background/60 pl-10" />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                    <FormControl>
                      <PasswordInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} placeholder="Enter your password" className="h-12 rounded-xl bg-background/60 pl-10" />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="lg" disabled={busy} className="group mt-1 h-12 justify-between rounded-xl px-5 text-base font-semibold shadow-glow">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" /> Signing in…
                </span>
              ) : (
                <>
                  Open the console <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </form>
        </Form>

        <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Manager or team? Sign in on the player portal instead.
        </p>
      </LoginScene>
    </div>
  );
}

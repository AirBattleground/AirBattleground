import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import type { z } from "zod";
import { AlertCircle, ArrowRight, Lock, User } from "lucide-react";
import { ApiError, loginSchema, type LoginInput } from "@7xen/shared";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
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
    <div className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <AnimatedBackground intensity="hero" />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="mb-8 flex flex-col items-center text-center">
          <Logo subtitle="Admin Console" className="scale-125" />
          <h1 className="mt-8 font-display text-4xl font-bold sm:text-5xl">
            Control the <span className="text-gradient-brand">drop zone</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Create logins for managers and teams. Keep the lobby running.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl border bg-card/80 p-6 shadow-glow backdrop-blur-xl sm:p-8"
        >
          <div className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
          <h2 className="font-display text-2xl font-bold">Admin sign in</h2>
          <p className="mb-6 text-sm text-muted-foreground">Owners only. Use the admin username and password.</p>

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
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Form {...form}>
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <div className="relative">
                      <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <FormControl>
                        <Input {...field} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="admin" className="h-11 pl-9" />
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
                      <Lock className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                      <FormControl>
                        <PasswordInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} placeholder="••••••••" className="h-11 pl-9" />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" size="lg" disabled={busy} className="group mt-2 h-11 text-base font-semibold">
                {busy ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            </form>
          </Form>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-6 text-center text-xs text-muted-foreground">
          Manager or team? Sign in on the player portal instead.
        </motion.p>
      </div>
    </div>
  );
}

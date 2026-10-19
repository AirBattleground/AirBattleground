import { Link } from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { ArrowLeft, Crosshair } from "lucide-react";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Logo } from "@7xen/ui/components/brand/logo";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import { homeFor, useAuth } from "@/lib/auth";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Shrinking "blue zone" rings around a crosshair. */
function PlayZone() {
  return (
    <div aria-hidden className="relative mx-auto size-56 sm:size-64">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full border-2 border-info/50"
          initial={{ scale: 1.25, opacity: 0 }}
          animate={{ scale: [1.25, 0.55], opacity: [0, 0.9, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, delay: i * 1.5, ease: "easeIn" }}
        />
      ))}
      <span className="absolute inset-6 rounded-full border border-dashed border-primary/40" />
      <span className="absolute inset-0 m-auto size-24 rounded-full bg-info/10 blur-xl" />
      <motion.span
        className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-2xl border border-primary/40 bg-card/80 text-primary shadow-glow backdrop-blur"
        animate={{ x: [0, 46, 38, 0], y: [0, -30, 22, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        <Crosshair className="size-8" />
      </motion.span>
    </div>
  );
}

export default function NotFoundPage() {
  const { user } = useAuth();
  const home = homeFor(user);
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background">
        <AnimatedBackground intensity="hero" />
        <header className="flex items-center justify-between px-4 py-4 sm:px-8 sm:py-6">
          <Link to={home} aria-label="AirBattleground home" className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Logo />
          </Link>
          <ThemeToggle className="bg-card/70 backdrop-blur" />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <PlayZone />
            <p className="mt-6 font-display text-7xl leading-none font-bold sm:text-8xl">
              <span className="text-gradient-brand">404</span>
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">You landed outside the play zone</h1>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              The page you're looking for doesn't exist or has moved. The zone is closing — get back to safety.
            </p>
            <Button asChild size="lg" className="mt-8 h-11 px-6 text-base font-semibold shadow-glow">
              <Link to={home}>
                <ArrowLeft className="size-4" />
                {user ? "Back to base" : "Go to sign in"}
              </Link>
            </Button>
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  );
}

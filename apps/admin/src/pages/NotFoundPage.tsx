import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, MapPinOff } from "lucide-react";
import { AnimatedBackground } from "@7xen/ui/components/brand/animated-background";
import { Logo } from "@7xen/ui/components/brand/logo";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12 text-center">
      <AnimatedBackground intensity="hero" />
      <div className="absolute top-4 left-4">
        <Link to="/" aria-label="AirBattleground home">
          <Logo subtitle="Admin Console" />
        </Link>
      </div>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <motion.div initial={{ y: -120, opacity: 0, rotate: -12 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 70, damping: 10 }} className="animate-float">
        <div className="flex size-20 items-center justify-center rounded-2xl border border-primary/40 bg-gradient-to-b from-primary/25 to-primary/5 text-primary shadow-glow">
          <MapPinOff className="size-10" />
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <div className="mt-6 font-display text-[7rem] leading-none font-bold sm:text-[10rem]">
          <span className="text-gradient-brand">404</span>
        </div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">You dropped outside the zone</h1>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">This page doesn't exist — and the blue zone is closing in. Rotate back to safety before you take damage.</p>
        <Button asChild size="lg" className="mt-8 shadow-glow">
          <Link to="/">
            <Home /> Back to the safe zone
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}

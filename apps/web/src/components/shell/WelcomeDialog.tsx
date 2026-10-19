import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Compass, Sparkles } from "lucide-react";
import type { SessionUser } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { useTour } from "@7xen/ui/tour";
import { readStorage, writeStorage } from "@/lib/storage";
import type { WelcomeStep } from "./types";

const welcomeKey = (userId: string) => `7xen.welcome.${userId}`;

/**
 * Shown once per user per browser. While it is open, page tours are paused so they don't
 * pop up behind it; "Take the tour" replays the current page's tour right after.
 */
export function WelcomeDialog({ user, steps }: { user: SessionUser; steps: WelcomeStep[] }) {
  const tour = useTour();
  const [open, setOpen] = useState(() => readStorage(welcomeKey(user.id)) !== "1");

  // Hold back first-visit page tours while the welcome is showing.
  const { pauseAutoRun } = tour;
  useEffect(() => {
    if (!open) return;
    return pauseAutoRun();
  }, [open, pauseAutoRun]);

  const dismiss = (takeTour: boolean) => {
    writeStorage(welcomeKey(user.id), "1");
    setOpen(false);
    if (takeTour) window.setTimeout(() => tour.start(), 300);
  };

  const name = user.role === "PLAYER" ? (user.player?.ign ?? user.displayName) : user.displayName;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss(false)}>
      <DialogContent className="overflow-hidden border-primary/30 p-0 shadow-glow sm:max-w-md" showCloseButton={false}>
        <div className="relative overflow-hidden px-6 pt-7 pb-2">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-56 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, var(--aurora-1), transparent 70%)" }} />
          <div aria-hidden className="absolute inset-0 bg-grid opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
          <DialogHeader className="relative text-left">
            <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> First drop
            </span>
            <DialogTitle className="font-display text-3xl font-bold leading-tight">
              Welcome to <span className="text-gradient-brand">7XEN</span>, {name}!
            </DialogTitle>
            <DialogDescription>Here's how it works — three simple steps.</DialogDescription>
          </DialogHeader>
        </div>

        <ol className="relative space-y-3 px-6 py-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.li
                key={s.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-start gap-3 rounded-xl border bg-card/60 p-3"
              >
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                  <span className="absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-lg font-bold leading-tight">{s.title}</span>
                  <span className="block text-sm text-muted-foreground">{s.text}</span>
                </span>
              </motion.li>
            );
          })}
        </ol>

        <DialogFooter className="gap-2 border-t bg-muted/40 px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={() => dismiss(false)}>
            I'll explore myself
          </Button>
          <Button onClick={() => dismiss(true)} className="shadow-glow" autoFocus>
            <Compass />
            Take the tour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

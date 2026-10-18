import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@7xen/ui/lib/utils";

const GREETINGS = [
  { text: "Welcome back.", lang: "en" },
  { text: "नमस्ते", lang: "hi" },
] as const;
const HOLD_MS = 2000;

/** "Welcome back." ↔ "नमस्ते", cross-fading with a soft blur like the iPhone hello screen. */
export function WelcomeHeading({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce) return;
    // hold the first greeting until the boot splash (index.html #splash, ~2.5s incl. fade) is gone
    const behindSplash = document.getElementById("splash") ? Math.max(0, 2500 - performance.now()) : 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => setI((n) => (n + 1) % GREETINGS.length), HOLD_MS);
    }, behindSplash);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [reduce]);

  const g = GREETINGS[i] ?? GREETINGS[0];
  return (
    <h1 className={cn("relative font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl", className)}>
      <span className="sr-only">Welcome back.</span>
      {/* fixed line box so the form below never jumps between greetings */}
      <span aria-hidden className="relative block h-[1.15em]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={g.text}
            lang={g.lang}
            initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -14, filter: "blur(10px)" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-0 block whitespace-nowrap"
          >
            {g.text}
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}

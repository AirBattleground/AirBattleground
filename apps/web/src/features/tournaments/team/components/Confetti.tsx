import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

const COLORS = ["bg-primary", "bg-warning", "bg-success", "bg-info", "bg-chart-5"];

/** One-shot confetti burst over its (relative) parent. Renders nothing with reduced motion. */
export function Confetti({ pieces = 36 }: { pieces?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: 5 + Math.random() * 90,
        x: (Math.random() - 0.5) * 160,
        rotate: (Math.random() - 0.5) * 720,
        delay: Math.random() * 0.35,
        duration: 1.6 + Math.random() * 1.2,
        color: COLORS[i % COLORS.length],
        w: 5 + Math.random() * 5,
        round: Math.random() > 0.6,
      })),
    [pieces],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {bits.map((b) => (
        <motion.span
          key={b.id}
          className={`absolute top-0 ${b.color} ${b.round ? "rounded-full" : "rounded-[2px]"}`}
          style={{ left: `${b.left}%`, width: b.w, height: b.round ? b.w : b.w * 1.8 }}
          initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: 320, x: b.x, opacity: [1, 1, 0], rotate: b.rotate }}
          transition={{ duration: b.duration, delay: b.delay, ease: [0.2, 0.6, 0.4, 1] }}
        />
      ))}
    </div>
  );
}

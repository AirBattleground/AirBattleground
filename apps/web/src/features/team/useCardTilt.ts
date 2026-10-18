import { useRef, type PointerEvent } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Mouse-only 3D tilt + spotlight position for `.tc-card` cards, written straight to CSS vars and
 * the inline transform (no re-renders). `strength` scales the tilt — wide rows want less.
 */
export function useCardTilt<T extends HTMLElement>(strength = 1) {
  const reduce = useReducedMotion();
  const ref = useRef<T>(null);
  const onPointerMove = (e: PointerEvent<T>) => {
    const el = ref.current;
    if (!el || reduce || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--tc-mx", `${x * 100}%`);
    el.style.setProperty("--tc-my", `${y * 100}%`);
    el.style.transform = `perspective(1100px) rotateX(${(0.5 - y) * 5 * strength}deg) rotateY(${(x - 0.5) * 6 * strength}deg) translateY(-4px)`;
  };
  const onPointerLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return { ref, onPointerMove, onPointerLeave };
}

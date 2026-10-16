import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { driver, type DriveStep } from "driver.js";

/**
 * Guided "Take me on a tour" system (driver.js).
 *
 * - Wrap the app in <TourProvider>.
 * - Each page calls usePageTour("team.scrims", steps). Steps target elements by
 *   `[data-tour="..."]` selectors. The tour auto-runs the first time a user visits
 *   that page (remembered per browser + user key), and can be replayed any time.
 * - The topbar "Take a tour" button calls useTour().start() → runs the current page's tour.
 */
export interface TourStep {
  /** CSS selector, typically '[data-tour="register-btn"]'. Omit for a centered intro card. */
  element?: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
}

interface TourCtx {
  register: (key: string, steps: TourStep[]) => () => void;
  start: () => void;
  hasTour: () => boolean;
  /** namespace so different logins on one browser each get their first-run tour */
  setUserKey: (k: string | null) => void;
  /**
   * Suppress first-visit auto-runs (e.g. while a welcome dialog is open). A tour that would
   * auto-run while paused is skipped and marked seen; start() still works. Returns resume(). Ref-counted.
   */
  pauseAutoRun: () => () => void;
}

const Ctx = createContext<TourCtx | null>(null);
const SEEN_PREFIX = "7xen.tour.";

function run(steps: TourStep[]) {
  const visible = steps.filter((s) => !s.element || document.querySelector(s.element));
  if (!visible.length) return;
  const d = driver({
    showProgress: true,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: "sx-tour",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Got it!",
    progressText: "{{current}} of {{total}}",
    steps: visible.map<DriveStep>((s) => ({
      element: s.element,
      popover: { title: s.title, description: s.description, side: s.side, align: "start" },
    })),
  });
  d.drive();
}

export function TourProvider({ children }: { children: ReactNode }) {
  const current = useRef<{ key: string; steps: TourStep[] } | null>(null);
  const userKey = useRef<string | null>(null);
  const paused = useRef(0);

  const value: TourCtx = {
    register: useCallback((key, steps) => {
      current.current = { key, steps };
      const seenKey = `${SEEN_PREFIX}${userKey.current ?? "anon"}.${key}`;
      let seen = true;
      try {
        seen = localStorage.getItem(seenKey) === "1";
      } catch {
        /* storage blocked: don't auto-run */
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (!seen) {
        // let the page render its data before highlighting elements
        timer = setTimeout(() => {
          if (paused.current === 0) run(steps);
          try {
            localStorage.setItem(seenKey, "1");
          } catch {
            /* ignore */
          }
        }, 900);
      }
      return () => {
        if (timer) clearTimeout(timer);
        if (current.current?.key === key) current.current = null;
      };
    }, []),
    start: useCallback(() => {
      if (current.current) run(current.current.steps);
    }, []),
    hasTour: useCallback(() => current.current !== null, []),
    setUserKey: useCallback((k) => {
      userKey.current = k;
    }, []),
    pauseAutoRun: useCallback(() => {
      paused.current++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        paused.current--;
      };
    }, []),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTour() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTour must be used inside <TourProvider>");
  return ctx;
}

/** Register this page's tour. Pass a stable steps array (module-level const or useMemo). */
export function usePageTour(key: string, steps: TourStep[], enabled = true) {
  const { register } = useTour();
  useEffect(() => {
    if (!enabled) return;
    return register(key, steps);
  }, [key, steps, enabled, register]);
}

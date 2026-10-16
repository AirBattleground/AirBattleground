import { useCallback, useSyncExternalStore } from "react";

/** Live `window.matchMedia(query).matches`. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Tailwind `lg` breakpoint and up. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

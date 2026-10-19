import { useEffect } from "react";

/** The boot splash (index.html #splash) never goes away before this long (counted from navigation start)… */
const MIN_VISIBLE_MS = 1400;
/** …and never stays longer than this, even if the first screen never reports ready. */
const MAX_VISIBLE_MS = 7000;

let dismissed = false;

/** Fade out the boot splash (once). Call it when the first real screen is on its way to being visible. */
export function dismissSplash() {
  if (dismissed) return;
  dismissed = true;
  const el = document.getElementById("splash");
  if (!el) return;
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add("splash-out");
    el.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 800); // in case transitionend never fires (e.g. tab hidden)
  }, Math.max(0, MIN_VISIBLE_MS - performance.now()));
}

/** Safety net from main.tsx: the splash always leaves, even if a screen forgets to call dismissSplash. */
export function splashFailsafe() {
  setTimeout(dismissSplash, Math.max(0, MAX_VISIBLE_MS - performance.now()));
}

/** Render once the screen's own content is mounted (after lazy code + sign-in check) → the splash hands over to it. */
export function SplashReady() {
  useEffect(() => dismissSplash(), []);
  return null;
}

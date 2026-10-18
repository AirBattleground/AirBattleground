/** How long the boot splash (index.html #splash) stays up, counted from navigation start. */
const MIN_VISIBLE_MS = 2000;

/** Fade out the boot splash once it has been visible for MIN_VISIBLE_MS; the app renders underneath meanwhile. */
export function dismissSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add("splash-out");
    el.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 800); // in case transitionend never fires (e.g. tab hidden)
  }, Math.max(0, MIN_VISIBLE_MS - performance.now()));
}

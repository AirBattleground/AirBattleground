import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { Button } from "@7xen/ui/components/ui/button";

const KEY = "sx.chunk-reload";
const CHUNK_ERROR = /dynamically imported module|importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** A new version was deployed while this tab was open: its old script files are gone. Reload once to pick up the new ones. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false; // already tried a moment ago — don't loop
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked: still try once */
  }
  window.location.reload();
  return true;
}

/** Call once at start-up: Vite tells us when a lazy page's file can't be loaded. */
export function installChunkReload() {
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadOnce();
  });
}

/** Route error screen: a stale-version error reloads by itself; anything else gets a friendly message. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error ?? "");
  const stale = CHUNK_ERROR.test(message);
  useEffect(() => {
    if (stale) reloadOnce();
  }, [stale]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-bold">{stale ? "Updating to the latest version…" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {stale ? "AirBattleground was just updated. If this doesn't refresh by itself, tap Reload." : "Please reload the page. If it keeps happening, tell your organiser."}
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

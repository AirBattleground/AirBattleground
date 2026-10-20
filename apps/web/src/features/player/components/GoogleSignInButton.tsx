import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useSkin } from "@/lib/skin";
import { cn } from "@7xen/ui/lib/utils";

/** The slice of Google Identity Services we use (https://developers.google.com/identity/gsi/web/reference/js-reference). */
interface GsiId {
  initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: "popup"; auto_select?: boolean; itp_support?: boolean; context?: "signin" | "signup" | "use" }): void;
  renderButton(
    el: HTMLElement,
    opts: { type?: "standard"; theme?: "outline" | "filled_blue" | "filled_black"; size?: "large" | "medium"; text?: "continue_with" | "signin_with"; shape?: "pill" | "rectangular"; width?: number; logo_alignment?: "left" | "center" },
  ): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiPromise: Promise<GsiId> | null = null;

/** Loads the GIS script once, on demand. */
function loadGsi(): Promise<GsiId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  gsiPromise ??= new Promise<GsiId>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn't load")));
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error("Couldn't reach Google. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/**
 * Google's own "Continue with Google" button (required by Google's branding rules), sized to its container.
 * `onCredential` receives the ID token to send to POST /api/auth/google.
 */
export function GoogleSignInButton({ clientId, onCredential, busy, className }: { clientId: string; onCredential: (credential: string) => void; busy?: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  // Lux Battle is angular: Google's square-cornered button instead of the pill
  const shape = useSkin().isLux ? "rectangular" : "pill";

  useEffect(() => {
    let live = true;
    loadGsi()
      .then((gsi) => {
        if (!live || !host.current) return;
        gsi.initialize({ client_id: clientId, ux_mode: "popup", auto_select: false, itp_support: true, context: "signin", callback: (r) => r.credential && cb.current(r.credential) });
        const width = Math.min(400, Math.max(220, Math.round(host.current.getBoundingClientRect().width)));
        gsi.renderButton(host.current, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape, width, logo_alignment: "left" });
        setState("ready");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setState("error");
        setError(e instanceof Error ? e.message : "Google sign-in is unavailable right now.");
      });
    return () => {
      live = false;
    };
  }, [clientId, shape]);

  return (
    <div className={cn("relative", className)} data-tour="google-signin">
      <div ref={host} className={cn("flex min-h-11 w-full justify-center [&_iframe]:!mx-auto [color-scheme:light] [&_iframe]:[color-scheme:light]", (state !== "ready" || busy) && "pointer-events-none", busy && "opacity-60")} />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full border bg-card/80 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading Google sign-in…
        </div>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full bg-background/40 text-sm font-semibold">
          <Loader2 className="size-4 animate-spin" /> Signing you in…
        </div>
      )}
      {state === "error" && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

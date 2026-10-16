import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function systemTheme(): Resolved {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: Resolved, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 500);
  }
  root.classList.toggle("dark", resolved === "dark");
}

/**
 * Light / dark / system theme. Defaults to dark (esports). Persisted per app via `storageKey`.
 * Add this inline script to index.html <head> to avoid a flash before React mounts:
 *   <script>try{var t=localStorage.getItem("7xen.theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}</script>
 */
export function ThemeProvider({ children, defaultTheme = "dark", storageKey = "7xen.theme" }: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const [resolvedTheme, setResolved] = useState<Resolved>(() => (theme === "system" ? systemTheme() : theme));

  useEffect(() => {
    const r = theme === "system" ? systemTheme() : theme;
    setResolved(r);
    apply(r, true);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = systemTheme();
      setResolved(next);
      apply(next, true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => {
      try {
        localStorage.setItem(storageKey, t);
      } catch {
        /* ignore */
      }
      setThemeState(t);
    },
    [storageKey],
  );
  const toggle = useCallback(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"), [resolvedTheme, setTheme]);

  return <Ctx.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

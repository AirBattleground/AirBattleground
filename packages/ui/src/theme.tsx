import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

/** Brand colour presets (globals.css `:root[data-brand="…"]`); "custom" is generated from a picked colour. */
export const BRANDS = [
  { id: "teal", label: "Teal", swatch: "#084949" },
  { id: "gold", label: "Gold", swatch: "#ac8d1b" },
] as const;
export type Brand = (typeof BRANDS)[number]["id"] | "custom";
export const DEFAULT_BRAND: Brand = "teal";
/**
 * Theme + brand switchers are hidden for now: everyone gets dark + teal and saved choices are ignored. To go live,
 * set this to true AND restore the localStorage reads in the two index.html boot scripts (apps/web, apps/admin).
 */
export const THEME_CONTROLS_ENABLED = false;
export const DEFAULT_CUSTOM_COLOR = "#084949";
const BRAND_KEY = "7xen.brand";
/** custom brand: the picked hex, and the generated CSS (the index.html script injects it before paint) */
const CUSTOM_COLOR_KEY = "7xen.brand.color";
const CUSTOM_CSS_KEY = "7xen.brand.css";
const CUSTOM_STYLE_ID = "sx-brand-custom";
const isBrand = (v: unknown): v is Brand => v === "custom" || BRANDS.some((b) => b.id === v);
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** sRGB hex → OKLCH (L 0..1, C, H degrees). */
export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const lin = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(1), lin(3), lin(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/**
 * Every brand token for a picked colour, light + dark — same recipe as the teal preset in globals.css: the hue is
 * kept, chroma is clamped to a usable range, and lightness is set per mode so buttons stay readable.
 */
export function brandCss(hex: string): string {
  const { c: c0, h: h0 } = hexToOklch(hex);
  const grey = c0 < 0.03; // greys: neutral brand, no hue
  const H = grey ? 260 : Math.round(h0);
  const C = grey ? 0.02 : Math.min(0.24, Math.max(0.1, c0));
  const ok = (l: number, c: number, a?: number) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${H}${a == null ? "" : ` / ${a}`})`;
  const white = "oklch(0.99 0 0)";
  const ink = ok(0.17, 0.04);
  const lightL = 0.5;
  const darkL = 0.74;
  const scale = (
    [["50", 0.98, 0.1], ["100", 0.95, 0.22], ["200", 0.9, 0.43], ["300", 0.83, 0.67], ["400", 0.75, 0.86], ["500", 0.68, 1], ["600", 0.6, 1], ["700", 0.51, 0.86], ["800", 0.43, 0.67], ["900", 0.37, 0.52], ["950", 0.24, 0.38]] as const
  )
    .map(([k, l, m]) => `--brand-${k}:${ok(l, C * m)};`)
    .join("");
  const mode = (L: number, fg: string, accent: string, accentFg: string, sbAccent: string, sbAccentFg: string, glowA: number, aurora: string) =>
    `--primary:${ok(L, C)};--primary-foreground:${fg};--ring:${ok(L, C)};--accent:${accent};--accent-foreground:${accentFg};` +
    `--chart-1:${ok(L, C)};--sidebar-primary:${ok(L, C)};--sidebar-primary-foreground:${fg};--sidebar-accent:${sbAccent};` +
    `--sidebar-accent-foreground:${sbAccentFg};--sidebar-ring:${ok(L, C)};--glow:${ok(L, C, glowA)};--aurora-1:${aurora};`;
  const light = mode(lightL, white, ok(0.95, 0.03), ok(0.36, C * 0.6), ok(0.94, 0.03), ok(0.34, C * 0.6), 0.35, ok(0.8, C * 0.75, 0.45));
  const dark = mode(darkL, ink, ok(0.28, 0.045), ok(0.9, C * 0.4), ok(0.26, 0.04), ok(0.95, C * 0.3), 0.45, ok(0.6, C, 0.35));
  return `:root[data-brand="custom"]{${light}${scale}}:root.dark[data-brand="custom"]{${dark}}`;
}

interface ThemeCtx {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  brand: Brand;
  setBrand: (b: Brand) => void;
  /** the custom brand's colour (hex); setting it switches to the custom brand */
  customColor: string;
  setCustomColor: (hex: string) => void;
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

/** Put the brand on <html> and re-colour the favicon to match (the logo follows the brand-* tokens by itself). */
function applyBrand(brand: Brand, customColor: string, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 500);
  }
  if (brand === "custom") {
    let el = document.getElementById(CUSTOM_STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = CUSTOM_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = brandCss(customColor);
  }
  root.dataset.brand = brand;
  const css = getComputedStyle(root);
  const c = (k: string) => css.getPropertyValue(k).trim();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c("--brand-300")}"/><stop offset=".5" stop-color="${c("--brand-500")}"/><stop offset="1" stop-color="${c("--brand-700")}"/></linearGradient></defs><path d="M20 2 36 11v18L20 38 4 29V11z" fill="url(#g)"/><path d="M12 13h16l-9 15h-4.5l7.2-11.6H12z" fill="#fff"/></svg>`;
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((l) => {
    if (l.type === "image/svg+xml" || l.href.endsWith(".svg") || l.href.startsWith("data:image/svg")) l.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
}

function initialBrand(): Brand {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("brand");
    if (isBrand(fromUrl)) {
      localStorage.setItem(BRAND_KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(BRAND_KEY);
    return isBrand(saved) ? saved : DEFAULT_BRAND;
  } catch {
    return DEFAULT_BRAND;
  }
}

/**
 * Light / dark / system theme. Defaults to dark (esports). Persisted per app via `storageKey`.
 * Add this inline script to index.html <head> to avoid a flash before React mounts:
 *   <script>try{var t=localStorage.getItem("7xen.theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}</script>
 * Brand colour: `brand` / `setBrand` (teal or "custom") and `customColor` / `setCustomColor` (any hex), saved in
 * localStorage "7xen.brand*" (shared by web + admin, same origin); `?brand=teal|gold|custom` in the URL picks one too.
 * index.html sets data-brand (and injects the saved custom CSS) before paint — see the script in apps/web/index.html.
 */
export function ThemeProvider({ children, defaultTheme = "dark", storageKey = "7xen.theme" }: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (!THEME_CONTROLS_ENABLED) return "dark";
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

  const [brand, setBrandState] = useState<Brand>(() => (THEME_CONTROLS_ENABLED ? initialBrand() : DEFAULT_BRAND));
  const [customColor, setCustomColorState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_COLOR_KEY);
      return isHex(saved) ? saved : DEFAULT_CUSTOM_COLOR;
    } catch {
      return DEFAULT_CUSTOM_COLOR;
    }
  });
  const firstBrand = useRef(true);
  useEffect(() => {
    applyBrand(brand, customColor, !firstBrand.current);
    firstBrand.current = false;
  }, [brand, customColor]);
  const setBrand = useCallback((b: Brand) => {
    try {
      localStorage.setItem(BRAND_KEY, b);
    } catch {
      /* ignore */
    }
    setBrandState(b);
  }, []);
  const setCustomColor = useCallback(
    (hex: string) => {
      if (!isHex(hex)) return;
      try {
        localStorage.setItem(CUSTOM_COLOR_KEY, hex);
        localStorage.setItem(CUSTOM_CSS_KEY, brandCss(hex));
      } catch {
        /* ignore */
      }
      setCustomColorState(hex);
      setBrand("custom");
    },
    [setBrand],
  );

  return <Ctx.Provider value={{ theme, resolvedTheme, setTheme, toggle, brand, setBrand, customColor, setCustomColor }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

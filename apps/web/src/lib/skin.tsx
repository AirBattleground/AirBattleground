/**
 * Site look ("skin"): Teal Battle (teal, the sidebar app) or Lux Battle (lux, branded site with top nav + tactical
 * graphics). The admin picks it for everyone (GET /api/site/skin); pages are shared, only the chrome differs.
 *
 *  - <html data-skin="teal|lux"> is set before paint by the script in index.html (last-seen choice, cached in
 *    localStorage "7xen.skin"); this provider then confirms it with the API and switches if the admin changed it.
 *  - `?skin=lux` (or teal) previews a look in this tab only (sessionStorage), without touching the saved choice.
 *  - Lux styles live in src/skins/lux/ and are all scoped under `[data-skin="lux"]`.
 */
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_UI_SKIN, isUiSkin, type UiSkin, type UiSkinResponse } from "@7xen/shared";
import { LoaderProvider } from "@7xen/ui/components/brand/page";
import { api } from "@/lib/api";
import { readStorage, writeStorage } from "@/lib/storage";
import { LuxLoader } from "@/skins/lux/LuxLoader";

const SKIN_KEY = "7xen.skin";
const PREVIEW_KEY = "7xen.skin.preview";
const LUX_FONTS_ID = "sx-lux-fonts";
const LUX_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Chakra+Petch:wght@400;500;600;700&family=Share+Tech+Mono&display=swap";

export const skinKeys = { site: ["site", "skin"] as const };

function previewSkin(): UiSkin | null {
  try {
    const v = sessionStorage.getItem(PREVIEW_KEY);
    return isUiSkin(v) ? v : null;
  } catch {
    return null;
  }
}

function initialSkin(): UiSkin {
  const fromHtml = document.documentElement.dataset.skin;
  if (isUiSkin(fromHtml)) return fromHtml;
  const saved = readStorage(SKIN_KEY);
  return isUiSkin(saved) ? saved : DEFAULT_UI_SKIN;
}

function applySkin(skin: UiSkin) {
  const root = document.documentElement;
  if (root.dataset.skin !== skin) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 500);
    root.dataset.skin = skin;
  }
  if (skin === "lux" && !document.getElementById(LUX_FONTS_ID)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.id = LUX_FONTS_ID;
    l.href = LUX_FONTS_HREF;
    document.head.appendChild(l);
  }
}

/** The admin's choice (public endpoint). The first fetch reuses the request index.html already started. */
export function useSiteSkin() {
  return useQuery({
    queryKey: skinKeys.site,
    queryFn: async () => {
      const early = (window as { __sxSkin?: Promise<UiSkinResponse | undefined> }).__sxSkin;
      if (early) {
        delete (window as { __sxSkin?: unknown }).__sxSkin;
        const r = await early;
        if (r && isUiSkin(r.skin)) return r;
      }
      return api.get<UiSkinResponse>("/api/site/skin");
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

interface SkinCtx {
  skin: UiSkin;
  isLux: boolean;
  /** true while `?skin=` is previewing a look in this tab */
  previewing: boolean;
  /** stop previewing and go back to the admin's choice */
  clearPreview: () => void;
}

const Ctx = createContext<SkinCtx>({ skin: DEFAULT_UI_SKIN, isLux: false, previewing: false, clearPreview: () => {} });

export function SkinProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<UiSkin | null>(previewSkin);
  const [skin, setSkin] = useState<UiSkin>(() => preview ?? initialSkin());
  const site = useSiteSkin();
  const siteSkin = site.data?.skin;

  useEffect(() => {
    if (!siteSkin || !isUiSkin(siteSkin)) return;
    writeStorage(SKIN_KEY, siteSkin);
    if (!preview) setSkin(siteSkin);
  }, [siteSkin, preview]);

  useEffect(() => {
    applySkin(skin);
  }, [skin]);

  const clearPreview = () => {
    try {
      sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* ignore */
    }
    setPreview(null);
    setSkin(siteSkin && isUiSkin(siteSkin) ? siteSkin : initialSkin());
  };

  const isLux = skin === "lux";
  return (
    <Ctx.Provider value={{ skin, isLux, previewing: preview != null, clearPreview }}>
      {isLux ? <LoaderProvider value={LuxLoader}>{children}</LoaderProvider> : children}
    </Ctx.Provider>
  );
}

export function useSkin() {
  return useContext(Ctx);
}

/**
 * Render `lux` (lazy-loaded, so Teal visitors never download Lux code) when the Lux skin is on, else `teal`.
 * `fallback` shows while the Lux chunk loads (defaults to the Lux loader).
 */
export function SkinSwitch({ teal, lux, fallback }: { teal: ReactNode; lux: ReactNode; fallback?: ReactNode }) {
  const { isLux } = useSkin();
  if (!isLux) return <>{teal}</>;
  return <Suspense fallback={fallback ?? <LuxLoader label="Loading…" fullscreen />}>{lux}</Suspense>;
}


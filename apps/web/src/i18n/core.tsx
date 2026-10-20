/**
 * Portal languages (phase 7c): English, Hindi (Devanagari) and Hinglish (Hindi in Roman letters).
 *
 * - Strings live next to the feature in `<feature>/i18n.ts` (or src/i18n/*.ts) as `defineMessages({ en, hi, hinglish })`.
 *   The type makes Hindi and Hinglish carry exactly the English keys, so a missing translation fails the typecheck.
 * - In a component: `const t = useT(messages)` → `t("key")`, `t("key", { name })`, `t.plural("scrims", n)` (keys
 *   `scrims_one` / `scrims_other`, `{count}` filled in) and `t.rich("key", { link: (s) => <Link>{s}</Link> })` for
 *   `<link>text</link>` tags inside a sentence.
 * - Which language: what the player picked on this device (localStorage) → their profile → the device language (Hindi
 *   phones start in Hindi; Hinglish is opt-in). Managers and admins always see English (their pages aren't translated).
 * - Dates: `useDateFormat()` → `fmt(date, "EEE, d MMM")` with Hindi month/day names in Hindi.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { format as dfFormat, parseISO } from "date-fns";
import { hi as dfHi } from "date-fns/locale";
import { isLanguage, type Language } from "@7xen/shared";
import { useAuth } from "@/lib/auth";
import { readStorage, writeStorage } from "@/lib/storage";
import { api } from "@/lib/api";

export type { Language };

export const LANGUAGE_META: Record<Language, { label: string; short: string; htmlLang: string }> = {
  en: { label: "English", short: "EN", htmlLang: "en" },
  hi: { label: "हिंदी", short: "हिं", htmlLang: "hi" },
  hinglish: { label: "Hinglish", short: "HiEn", htmlLang: "hi-Latn" },
};

const STORAGE_KEY = "7xen.lang";

type Dict = Record<string, string>;
export interface Messages<E extends Dict> {
  en: E;
  hi: { [K in keyof E]: string };
  hinglish: { [K in keyof E]: string };
}

/** Declare a namespace's strings. Hindi + Hinglish must have the same keys as English. */
export function defineMessages<E extends Dict>(m: Messages<E>): Messages<E> {
  return m;
}

type Vars = Record<string, string | number>;
type PluralBase<K> = K extends `${infer B}_other` ? B : never;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : s);

/** `<tag>text</tag>` and `{var}` → React nodes. */
function richParts(s: string, tags: Record<string, (chunk: ReactNode) => ReactNode>, vars?: Vars): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(fill(s.slice(last, m.index), vars));
    const fn = tags[m[1]!];
    out.push(<span key={i++}>{fn ? fn(fill(m[2]!, vars)) : fill(m[2]!, vars)}</span>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(fill(s.slice(last), vars));
  return out;
}

// ---------------------------------------------------------------- provider

interface LocaleCtx {
  lang: Language;
  setLang: (l: Language) => void;
  /** players (and visitors) can switch; managers/admins are fixed to English */
  canSwitch: boolean;
}

const Ctx = createContext<LocaleCtx>({ lang: "en", setLang: () => {}, canSwitch: true });

function deviceLanguage(): Language {
  try {
    return navigator.languages?.some((l) => l.toLowerCase().startsWith("hi")) ? "hi" : "en";
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const [picked, setPicked] = useState<Language | null>(() => {
    const v = readStorage(STORAGE_KEY);
    return isLanguage(v) ? v : null;
  });
  const staff = user?.role === "MANAGER" || user?.role === "ADMIN";
  const profile = user?.player?.language ?? null;
  const lang: Language = staff ? "en" : (picked ?? profile ?? deviceLanguage());

  useEffect(() => {
    document.documentElement.lang = LANGUAGE_META[lang].htmlLang;
  }, [lang]);

  const setLang = useCallback(
    (l: Language) => {
      setPicked(l);
      writeStorage(STORAGE_KEY, l);
      // signed-in players: remember it on the profile too (other devices follow)
      if (user?.role === "PLAYER" && user.player?.language !== l) {
        void api
          .patch("/api/player/me", { language: l })
          .then(() => refresh())
          .catch(() => undefined);
      }
    },
    [user, refresh],
  );

  const value = useMemo(() => ({ lang, setLang, canSwitch: !staff }), [lang, setLang, staff]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale() {
  return useContext(Ctx);
}

// ---------------------------------------------------------------- translate

export interface T<E extends Dict> {
  (key: keyof E & string, vars?: Vars): string;
  /** `key_one` when count is 1, else `key_other`; `{count}` is filled in */
  plural: (base: PluralBase<keyof E & string>, count: number, vars?: Vars) => string;
  /** sentence with `<tag>…</tag>` parts rendered by `tags` */
  rich: (key: keyof E & string, tags: Record<string, (chunk: ReactNode) => ReactNode>, vars?: Vars) => ReactNode;
  lang: Language;
}

/** Translator for one namespace in the current language (falls back to English per key). */
export function useT<E extends Dict>(m: Messages<E>): T<E> {
  const { lang } = useLocale();
  return useMemo(() => {
    const dict = m[lang] as Dict;
    const en = m.en as Dict;
    const raw = (key: string) => dict[key] ?? en[key] ?? key;
    const t = ((key: string, vars?: Vars) => fill(raw(key), vars)) as T<E>;
    t.plural = (base, count, vars) => fill(raw(`${base}_${count === 1 ? "one" : "other"}`), { count, ...vars });
    t.rich = (key, tags, vars) => <>{richParts(raw(key), tags, vars)}</>;
    t.lang = lang;
    return t;
  }, [lang, m]);
}

/**
 * Outside React (mutation callbacks, toasts): translate with the page's current language (<html lang>, set by
 * LocaleProvider).
 */
export function translateNow<E extends Dict>(m: Messages<E>, key: keyof E & string, vars?: Vars): string {
  const l = typeof document !== "undefined" ? document.documentElement.lang : "en";
  const lang: Language = l === "hi" ? "hi" : l === "hi-Latn" ? "hinglish" : "en";
  return fill((m[lang] as Dict)[key] ?? (m.en as Dict)[key] ?? key, vars);
}

/** date-fns format in the current language (Hindi month/day names for Hindi; Hinglish uses English names). */
export function useDateFormat() {
  const { lang } = useLocale();
  return useCallback(
    (date: string | Date, pattern: string) => dfFormat(typeof date === "string" ? parseISO(date) : date, pattern, lang === "hi" ? { locale: dfHi } : undefined),
    [lang],
  );
}

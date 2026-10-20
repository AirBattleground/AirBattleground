import { todayInAppTz } from "@7xen/shared";

/**
 * Featured-hero background art from src/assets/stage/ (`hero-bg-*`, see README there).
 * Several files rotate once a day (IST). No files → the hero sits on the plain page.
 */
const FILES = import.meta.glob<string>("/src/assets/stage/hero-bg-*.{png,webp,avif,jpg}", { eager: true, import: "default", query: "?url" });
const HERO_BGS = Object.entries(FILES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

export function heroBackground(): string | null {
  if (!HERO_BGS.length) return null;
  const day = Math.floor(Date.parse(`${todayInAppTz()}T00:00:00Z`) / 86_400_000);
  return HERO_BGS[day % HERO_BGS.length]!;
}

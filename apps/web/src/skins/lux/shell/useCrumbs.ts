import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { DATE_RE } from "@7xen/shared";
import type { NavItem } from "@/components/shell";

export interface Crumb {
  label: string;
  to?: string;
}

const DEFAULT_SEGMENT_LABELS: Record<string, string> = { new: "New", edit: "Edit" };

/** Same logic as the Teal Topbar: section from the best-matching nav item, then any deeper path segments. */
export function useCrumbs(nav: NavItem[], segmentLabels: Record<string, string>): Crumb[] {
  const { pathname } = useLocation();
  return useMemo(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    const match = [...nav]
      .filter((n) => path === n.to || (!n.end && path.startsWith(n.to + "/")))
      .sort((a, b) => b.to.length - a.to.length)[0];
    if (!match) return [];
    const crumbs: Crumb[] = [{ label: match.label, to: match.to }];
    const rest = path.slice(match.to.length).split("/").filter(Boolean);
    let acc = match.to;
    rest.forEach((seg, i) => {
      acc += `/${seg}`;
      // an id right before a date (".../:scrimId/:date") is shown as the date crumb only
      if (DATE_RE.test(rest[i + 1] ?? "") && !segmentLabels[seg]) return;
      const label = DATE_RE.test(seg) ? format(parseISO(seg), "EEE, d MMM") : (segmentLabels[seg] ?? DEFAULT_SEGMENT_LABELS[seg] ?? "Details");
      crumbs.push({ label, to: acc });
    });
    // the last crumb is the current page — not a link
    const last = crumbs[crumbs.length - 1];
    if (last) delete last.to;
    return crumbs;
  }, [nav, pathname, segmentLabels]);
}

/** Stable pseudo map-grid reference for a path, e.g. "D-5" (A–H / 1–8). Purely decorative. */
export function gridRef(path: string) {
  let h = 7;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  return `${"ABCDEFGH"[h % 8]}-${((h >> 3) % 8) + 1}`;
}

/** The nav item that carries live broadcasts (key "live") when it has a count. */
export const liveItemOf = (nav: NavItem[]) => nav.find((n) => n.key === "live" && (n.badge ?? 0) > 0);

/** Phase 4: how a scrim or tournament match is titled, when it starts and which slots it uses. */
import { sessionStartsAt } from "@7xen/shared";
import { dateToStr, strToDate } from "../lib/serialize.js";
import type { MatchWithOwner } from "./matches.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-18" → "Sat, 18 Oct" */
export function shortDate(date: string): string {
  const d = strToDate(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

type MatchCore = Pick<MatchWithOwner, "number" | "scheduledAt" | "session" | "group" | "createdAt">;

/** Kind, title, subtitle, planned start and slot range of a scrim or tournament match. */
export function matchContext(m: MatchCore) {
  if (m.session) {
    const sc = m.session.scrim;
    const date = dateToStr(m.session.date);
    return {
      kind: "SCRIM" as const,
      title: sc.title,
      subtitle: `${shortDate(date)} · Match ${m.number}`,
      startsAt: m.scheduledAt ?? sessionStartsAt(date, sc.startTime),
      slotRange: { first: sc.firstSlot, last: sc.firstSlot + sc.slotCount - 1 },
    };
  }
  const g = m.group!;
  const t = g.stage.tournament;
  return {
    kind: "TOURNAMENT" as const,
    title: t.title,
    subtitle: `${g.stage.name} · Group ${g.name} · Match ${m.number}`,
    startsAt: m.scheduledAt ?? g.startsAt ?? null,
    slotRange: { first: t.firstSlot, last: t.firstSlot + g.stage.lobbySize - 1 },
  };
}


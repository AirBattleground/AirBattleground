import type { CSSProperties, ReactNode } from "react";
import { MAP_LABELS, type GameMap, type PosterTemplate, type Recurrence } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

/**
 * Preset artwork for scrims without an uploaded poster. Drawn from the scrim's own details (title, maps, time,
 * organiser), so it follows edits and the site theme. A preset = an entry in PRESETS with a square (cards, scales with
 * its box via container units) and a strip (the home "Next match" banner: background only, the card writes the
 * title). To add one: POSTER_TEMPLATES in shared enums.ts + an entry here.
 */
export interface PosterData {
  title: string;
  maps: GameMap[];
  /** match 1's "HH:mm" */
  startTime: string;
  recurrence?: Recurrence;
  organiser?: string;
  template?: PosterTemplate;
}

/** Map colours — the same theme colours as the team's map dots (MapChips MAP_DOT), so a map looks alike everywhere. */
const MAP_HEX: Record<GameMap, string> = {
  ERANGEL: "var(--info)",
  MIRAMAR: "var(--warning)",
  SANHOK: "var(--success)",
  VIKENDI: "var(--muted-foreground)",
  LIVIK: "var(--chart-5)",
  KARAKIN: "var(--primary)",
  NUSA: "var(--chart-2)",
  RONDO: "var(--destructive)",
  WAREHOUSE: "var(--chart-1)",
  HANGAR: "var(--chart-3)",
  RUINS: "var(--chart-4)",
  LIBRARY: "var(--chart-2)",
  TOWN: "var(--chart-5)",
};
const ACCENT = "var(--primary)";
const hex = (m: GameMap | undefined) => (m ? MAP_HEX[m] : ACCENT);

/** "22:30" → "10:30 PM"; short = "10:30" */
function clock(hhmm: string, short = false): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const t = `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
  return short ? t : `${t} ${h >= 12 ? "PM" : "AM"}`;
}
const RECURRENCE: Record<Recurrence, string> = { ONCE: "ONE NIGHT", DAILY: "DAILY", WEEKENDS: "WEEKENDS" };
const matchesLabel = (n: number) => `${n} MATCH${n === 1 ? "" : "ES"}`;
/** "Rahul (Scrim Host)" → "RS": first letter/digit of the first two words that have one */
const initials = (s: string | undefined) =>
  (s ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "7X";
/** Title size in % of the square's width: long names step down so 2–3 lines still fit. */
const titleSize = (title: string) => (title.length <= 12 ? 17 : title.length <= 20 ? 14 : 11.5);
/** A stable 0/1 per scrim so the same preset doesn't look identical on every card. */
const flip = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;

/** font size in % of the box width, never below `min` px (small tiles on phones) */
const cq = (n: number, min = 0): CSSProperties => ({ fontSize: min ? `max(${min}px, ${n}cqw)` : `${n}cqw` });
const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("m-0 truncate font-display font-bold tracking-[0.2em] text-primary", className)} style={cq(5.7, 8.5)}>
    {children}
  </p>
);
const Title = ({ title, scale = 1 }: { title: string; scale?: number }) => (
  <p
    className="font-hero m-0 line-clamp-3 font-extrabold break-words text-foreground uppercase"
    style={{ fontSize: `${titleSize(title) * scale}cqw`, lineHeight: 0.92 }}
  >
    {title}
  </p>
);

// ---------------------------------------------------------------- A · Topo: map contour lines + drop marker

function TopoSquare({ d }: { d: PosterData }) {
  const c = hex(d.maps[0]);
  const f = flip(d.title);
  return (
    <>
      <svg aria-hidden viewBox="0 0 176 176" className="absolute inset-0 size-full" style={f ? { transform: "scaleY(-1)" } : undefined}>
        <g fill="none" stroke={c} strokeWidth="1" opacity="0.45">
          <path d="M-10 150 C 30 118, 62 166, 102 136 S 160 96, 190 120" />
          <path d="M-10 128 C 26 96, 70 142, 106 112 S 162 74, 190 96" />
          <path d="M-10 106 C 30 74, 72 120, 110 90 S 166 52, 190 72" />
          <path d="M-10 84 C 34 52, 76 96, 114 66 S 168 30, 190 48" />
          <path d="M118 30 C 140 20, 166 34, 160 54 C 154 72, 124 70, 116 54 C 110 42, 110 34, 118 30 Z" />
          <path d="M128 40 C 140 34, 154 42, 150 52 C 146 62, 130 60, 126 52 C 122 46, 122 42, 128 40 Z" />
        </g>
        <circle cx="138" cy="47" r="3.5" fill={ACCENT} />
        <circle cx="138" cy="47" r="9" fill="none" stroke={ACCENT} strokeWidth="1" opacity="0.6" />
      </svg>
      <Eyebrow className="absolute top-[7%] left-[7%]">SCRIM{d.recurrence ? ` · ${RECURRENCE[d.recurrence]}` : ""}</Eyebrow>
      <div className="absolute inset-x-[7%] bottom-[7%] flex flex-col gap-[4cqw]">
        <Title title={d.title} />
        <div className="flex h-[2.3cqw] gap-[1.7cqw]">
          {d.maps.map((m, i) => (
            <span key={i} className="flex-1 rounded-full" style={{ background: MAP_HEX[m] }} />
          ))}
        </div>
        <p className="m-0 truncate font-display font-semibold tracking-[0.08em] text-muted-foreground" style={cq(6.2, 8.5)}>
          {matchesLabel(d.maps.length)} · {clock(d.startTime)}
        </p>
      </div>
    </>
  );
}

function TopoStrip({ d }: { d: PosterData }) {
  const c = hex(d.maps[0]);
  return (
    <svg aria-hidden viewBox="0 0 396 128" preserveAspectRatio="none" className="absolute inset-0 size-full">
      <g fill="none" stroke={c} strokeWidth="1" opacity="0.45">
        <path d="M-10 110 C 60 80, 120 130, 200 96 S 330 60, 410 84" />
        <path d="M-10 88 C 64 58, 126 108, 206 74 S 336 38, 410 60" />
        <path d="M-10 66 C 70 36, 132 86, 212 52 S 340 16, 410 36" />
        <path d="M-10 44 C 74 16, 136 64, 216 30 S 344 -6, 410 14" />
        <path d="M300 30 C 330 18, 368 32, 360 52 C 352 70, 314 68, 304 52 C 298 42, 296 34, 300 30 Z" />
      </g>
      <circle cx="330" cy="46" r="3.5" fill={ACCENT} />
    </svg>
  );
}

// ---------------------------------------------------------------- B · Drop Zone: flight path + drop circle + outlined time

function DropZoneSquare({ d }: { d: PosterData }) {
  const c = hex(d.maps[0]);
  const more = d.maps.length > 1 ? ` +${d.maps.length - 1}` : "";
  return (
    <>
      <p
        aria-hidden
        className="font-hero absolute -top-[3%] -right-[5%] m-0 font-extrabold text-transparent opacity-40"
        style={{ fontSize: "44cqw", lineHeight: 1, WebkitTextStroke: `1px ${ACCENT}` }}
      >
        {clock(d.startTime, true)}
      </p>
      <svg aria-hidden viewBox="0 0 176 176" className="absolute inset-0 size-full">
        <line x1="-4" y1="30" x2="180" y2="118" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.85" />
        <path d="M14 34 L26 40 L14 46 L17 40 Z" fill={ACCENT} />
        <g stroke={c} strokeWidth="1.2">
          <circle cx="120" cy="91" r="16" fill="none" opacity="0.85" />
          <circle cx="120" cy="91" r="28" fill="none" strokeWidth="1" opacity="0.4" />
          <line x1="120" y1="57" x2="120" y2="67" />
          <line x1="120" y1="115" x2="120" y2="125" />
          <line x1="86" y1="91" x2="96" y2="91" />
          <line x1="144" y1="91" x2="154" y2="91" />
        </g>
      </svg>
      <div className="absolute inset-x-[7%] bottom-[7%] flex flex-col gap-[3cqw]">
        <Eyebrow>
          {matchesLabel(d.maps.length)} · {d.maps[0] ? MAP_LABELS[d.maps[0]].toUpperCase() : ""}
          {more}
        </Eyebrow>
        <Title title={d.title} />
      </div>
    </>
  );
}

function DropZoneStrip({ d }: { d: PosterData }) {
  const c = hex(d.maps[0]);
  return (
    <>
      <p
        aria-hidden
        className="font-hero absolute top-[4%] left-[3%] m-0 font-extrabold text-transparent opacity-35"
        style={{ fontSize: "5.5rem", lineHeight: 1, WebkitTextStroke: `1px ${ACCENT}` }}
      >
        {clock(d.startTime, true)}
      </p>
      <svg aria-hidden viewBox="0 0 396 128" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <line x1="-4" y1="20" x2="400" y2="76" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.85" />
        <circle cx="318" cy="64" r="16" fill="none" stroke={c} strokeWidth="1.2" opacity="0.85" />
        <circle cx="318" cy="64" r="30" fill="none" stroke={c} strokeWidth="1" opacity="0.4" />
      </svg>
    </>
  );
}

// ---------------------------------------------------------------- C · Lineup: one numbered bar per match

const tint = (m: GameMap, a: number) => `color-mix(in oklab, ${MAP_HEX[m]} ${a}%, transparent)`;

function LineupSquare({ d }: { d: PosterData }) {
  return (
    <div className="absolute inset-0 flex">
      <div className="flex w-[23%] flex-col gap-[1.2cqw] py-[1.2cqw] pl-[1.2cqw]">
        {d.maps.map((m, i) => (
          <div
            key={i}
            className="flex flex-1 items-center justify-center font-display font-bold text-foreground"
            style={{ ...cq(d.maps.length > 5 ? 5.5 : 7.4, 8), background: tint(m, 22), borderLeft: `max(2px, 0.6cqw) solid ${MAP_HEX[m]}` }}
          >
            {String(i + 1).padStart(2, "0")}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between p-[7%]">
        <span
          className="grid size-[16cqw] place-items-center self-start rounded-[4.5cqw] border border-primary font-display font-bold text-primary"
          style={cq(6.8, 8.5)}
        >
          {initials(d.organiser)}
        </span>
        <div className="flex flex-col gap-[3cqw]">
          <Title title={d.title} scale={0.85} />
          <p className="m-0 font-display font-bold text-primary" style={{ ...cq(10.2), lineHeight: 1 }}>
            {clock(d.startTime)}
          </p>
        </div>
      </div>
    </div>
  );
}

function LineupStrip({ d }: { d: PosterData }) {
  return (
    <div aria-hidden className="absolute inset-0 flex gap-0.5">
      {d.maps.map((m, i) => (
        <div
          key={i}
          className="flex-1 truncate px-2 pt-1.5 font-display text-[11px] font-bold tracking-[0.14em]"
          style={{ background: tint(m, 16), borderTop: `3px solid ${MAP_HEX[m]}`, color: MAP_HEX[m] }}
        >
          {String(i + 1).padStart(2, "0")} {d.maps.length <= 4 ? MAP_LABELS[m].toUpperCase() : ""}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- registry

export const POSTER_PRESETS: Record<PosterTemplate, { label: string; description: string; Square: (p: { d: PosterData }) => ReactNode; Strip: (p: { d: PosterData }) => ReactNode }> = {
  TOPO: { label: "Topo", description: "Map contour lines with a drop marker", Square: TopoSquare, Strip: TopoStrip },
  DROPZONE: { label: "Drop Zone", description: "Flight path, drop circle and your start time", Square: DropZoneSquare, Strip: DropZoneStrip },
  LINEUP: { label: "Lineup", description: "One coloured bar per match, like a broadcast", Square: LineupSquare, Strip: LineupStrip },
};

/** The scrim's preset art. `square` fills its (square) box, title included; `strip` is background only. */
export function ScrimPosterArt({ data, variant, className }: { data: PosterData; variant: "square" | "strip"; className?: string }) {
  const preset = POSTER_PRESETS[data.template ?? "TOPO"] ?? POSTER_PRESETS.TOPO;
  const Art = variant === "square" ? preset.Square : preset.Strip;
  return (
    <div className={cn("@container relative size-full overflow-hidden bg-card", className)} role={variant === "square" ? "img" : undefined} aria-label={variant === "square" ? data.title : undefined}>
      <Art d={data} />
    </div>
  );
}

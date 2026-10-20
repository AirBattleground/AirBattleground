import { useState } from "react";
import { Building2 } from "lucide-react";
import type { OrganizerRef } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { SectionHeader } from "./SectionHeader";
import { useT } from "@/i18n/core";
import { homeMsg } from "@/i18n/home";

export interface OrganiserTally {
  manager: OrganizerRef;
  scrims: number;
  tournaments: number;
}

/** Merge every organiser seen across the home page's data, counting what each one runs. */
export function tallyOrganisers(scrims: OrganizerRef[], tournaments: OrganizerRef[]): OrganiserTally[] {
  const map = new Map<string, OrganiserTally>();
  const add = (m: OrganizerRef, key: "scrims" | "tournaments") => {
    const row = map.get(m.id) ?? { manager: m, scrims: 0, tournaments: 0 };
    if (!row.manager.logoUrl && m.logoUrl) row.manager = m;
    row[key] += 1;
    map.set(m.id, row);
  };
  scrims.forEach((m) => add(m, "scrims"));
  tournaments.forEach((m) => add(m, "tournaments"));
  return [...map.values()].sort((a, b) => Number(!!b.manager.logoUrl) - Number(!!a.manager.logoUrl) || b.scrims + b.tournaments - (a.scrims + a.tournaments));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Logo({ m }: { m: OrganizerRef }) {
  const [failed, setFailed] = useState(false);
  if (m.logoUrl && !failed) {
    return (
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted ring-1 ring-border sm:size-16 dark:bg-foreground/90">
        <img src={m.logoUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-contain p-[10%]" />
      </span>
    );
  }
  return (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-700 font-display text-lg font-bold text-primary-foreground shadow-sm sm:size-16">
      {initials(m.displayName) || <Building2 className="size-6" />}
    </span>
  );
}

function Tile({ t, dup }: { t: OrganiserTally; dup?: boolean }) {
  const tr = useT(homeMsg);
  const bits = [t.scrims && tr.plural("org_scrims", t.scrims), t.tournaments && tr.plural("org_cups", t.tournaments)].filter(Boolean);
  return (
    <li aria-hidden={dup || undefined} className="group flex w-56 shrink-0 items-center gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow">
      <Logo m={t.manager} />
      <span className="min-w-0">
        <span className="block truncate font-display text-base leading-tight font-bold">{t.manager.displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{bits.join(" · ") || tr("organiser")}</span>
      </span>
    </li>
  );
}

/** "Hosted by" wall of organiser logos; scrolls on its own when there are enough to fill the row. */
export function OrganiserStrip({ items }: { items: OrganiserTally[] }) {
  const tr = useT(homeMsg);
  if (items.length === 0) return null;
  const marquee = items.length >= 5;
  return (
    <section className="space-y-4" data-tour="organisers">
      <SectionHeader eyebrow={tr("org_eyebrow")} title={tr("org_title")} icon={<Building2 />} />
      <div className={cn("relative", marquee && "home-marquee-mask overflow-hidden")}>
        <ul className={cn("flex gap-3", marquee ? "home-marquee w-max" : "home-rail -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0")}>
          {items.map((t) => (
            <Tile key={t.manager.id} t={t} />
          ))}
          {marquee && items.map((t) => <Tile key={`dup-${t.manager.id}`} t={t} dup />)}
        </ul>
      </div>
    </section>
  );
}

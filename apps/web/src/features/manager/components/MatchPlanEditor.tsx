import { ArrowDown, ArrowUp, Clock, DoorOpen, Lock, Plus, Timer, X } from "lucide-react";
import {
  addMinutesToTime,
  BR_MAPS,
  DEFAULT_IDP_MINUTES,
  MAP_LABELS,
  matchOffsets,
  TDM_MAPS,
  type GameMap,
} from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { formatTime } from "../format";
import { MAP_STYLES } from "./maps";
import { TimeSelect } from "./TimeSelect";

export const MAX_MATCHES = 8;
export const DEFAULT_GAP = 40;
const GAPS = [20, 25, 30, 35, 40, 45, 50, 60];
const IDPS = [5, 10, 15, 20, 30];
const CLOSE_BEFORE = [5, 10, 15, 20, 30, 45, 60];
const NEXT_MAPS: GameMap[] = ["ERANGEL", "MIRAMAR", "RONDO", "SANHOK"];

export interface MatchPlanValue {
  maps: GameMap[];
  matchTimes: string[];
  idpMinutes: number[];
}

/** Minutes between match 1 and 2 (the gap new matches use), DEFAULT_GAP when there's one match. */
export function gapOf(times: string[]): number {
  const offsets = matchOffsets(times);
  return offsets.length > 1 ? offsets[1]! - offsets[0]! : DEFAULT_GAP;
}

/** Days after match 1's date each match starts on (0 = same day). */
function dayShifts(times: string[]): number[] {
  if (!times.length) return [];
  const [h = 0, m = 0] = times[0]!.split(":").map(Number);
  return matchOffsets(times).map((o) => Math.floor((h * 60 + m + o) / 1440));
}

/**
 * The scrim's matches: how many, then for each one its map, start time and IDP (room ID/password reveal).
 * Moving match 1 moves every match with it; "Space evenly" re-times matches 2+ from match 1 by the gap.
 */
export function MatchPlanEditor({ value, onChange, timeErrors }: {
  value: MatchPlanValue;
  onChange: (v: MatchPlanValue) => void;
  /** per-match start time errors, by index */
  timeErrors?: (string | undefined)[];
}) {
  const { maps, matchTimes, idpMinutes } = value;
  const gap = gapOf(matchTimes);
  const days = dayShifts(matchTimes);

  const setCount = (n: number) => {
    if (n < 1 || n > MAX_MATCHES || n === maps.length) return;
    if (n < maps.length) {
      onChange({ maps: maps.slice(0, n), matchTimes: matchTimes.slice(0, n), idpMinutes: idpMinutes.slice(0, n) });
      return;
    }
    const next = { maps: [...maps], matchTimes: [...matchTimes], idpMinutes: [...idpMinutes] };
    while (next.maps.length < n) {
      const i = next.maps.length;
      next.maps.push(NEXT_MAPS[i % NEXT_MAPS.length]!);
      next.matchTimes.push(addMinutesToTime(next.matchTimes[i - 1] ?? "20:00", i === 0 ? 0 : gap));
      next.idpMinutes.push(next.idpMinutes[i - 1] ?? DEFAULT_IDP_MINUTES);
    }
    onChange(next);
  };

  const setTime = (i: number, t: string) => {
    if (i === 0) {
      // match 1 moves the whole night, keeping the gaps
      const delta = matchOffsets([matchTimes[0]!, t])[1]!;
      const shift = delta > 720 ? delta - 1440 : delta;
      onChange({ ...value, matchTimes: matchTimes.map((x) => addMinutesToTime(x, shift)) });
      return;
    }
    onChange({ ...value, matchTimes: matchTimes.map((x, k) => (k === i ? t : x)) });
  };

  const spaceEvenly = (g: number) =>
    onChange({ ...value, matchTimes: matchTimes.map((_, k) => addMinutesToTime(matchTimes[0]!, k * g)) });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= maps.length) return;
    const swap = <T,>(xs: T[]) => {
      const next = [...xs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    };
    // the map (and its IDP) moves; the time slots stay in order
    onChange({ ...value, maps: swap(maps), idpMinutes: swap(idpMinutes) });
  };

  // removing a match keeps the time slots compact: later maps move up into the earlier slots
  const remove = (i: number) =>
    onChange({
      maps: maps.filter((_, k) => k !== i),
      matchTimes: matchTimes.slice(0, maps.length - 1),
      idpMinutes: idpMinutes.filter((_, k) => k !== i),
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">How many matches?</p>
        <div role="radiogroup" aria-label="Number of matches" className="flex flex-wrap gap-1.5">
          {Array.from({ length: MAX_MATCHES }, (_, k) => k + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={maps.length === n}
              onClick={() => setCount(n)}
              className={cn(
                "grid size-10 place-items-center rounded-lg border font-display text-base font-bold transition-colors",
                maps.length === n ? "border-primary bg-primary text-primary-foreground shadow-glow" : "bg-card hover:border-primary/40",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {maps.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5 text-sm">
          <Timer className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Space matches</span>
          <Select value={String(GAPS.includes(gap) ? gap : "")} onValueChange={(v) => spaceEvenly(Number(v))}>
            <SelectTrigger aria-label="Minutes between matches" className="h-9 w-32 font-semibold">
              <SelectValue placeholder="Custom gaps" />
            </SelectTrigger>
            <SelectContent>
              {GAPS.map((g) => (
                <SelectItem key={g} value={String(g)}>
                  {g} min apart
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">or set each time below</span>
        </div>
      )}

      <ol className="space-y-2">
        {maps.map((map, i) => {
          const time = matchTimes[i] ?? "20:00";
          const idp = idpMinutes[i] ?? DEFAULT_IDP_MINUTES;
          const err = timeErrors?.[i];
          return (
            <li key={i} className={cn("rounded-xl border bg-gradient-to-r to-transparent p-3", MAP_STYLES[map].solid, err && "border-destructive")}>
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/80 font-display text-lg font-bold">{i + 1}</span>
                <Select value={map} onValueChange={(v) => onChange({ ...value, maps: maps.map((x, k) => (k === i ? (v as GameMap) : x)) })}>
                  <SelectTrigger aria-label={`Match ${i + 1} map`} className="h-10 min-w-0 flex-1 bg-background/80 font-display text-base font-bold sm:max-w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectGroup>
                      <SelectLabel>Battle royale</SelectLabel>
                      {BR_MAPS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MAP_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Team Deathmatch (TDM)</SelectLabel>
                      {TDM_MAPS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MAP_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="ml-auto flex items-center">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move match ${i + 1} map up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move match ${i + 1} map down`} disabled={i === maps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove match ${i + 1}`}
                    disabled={maps.length === 1}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove(i)}
                  >
                    <X />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:pl-12">
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="size-3" /> Match starts
                    {(days[i] ?? 0) > 0 && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning normal-case tracking-normal">next day</span>}
                  </p>
                  <TimeSelect compact value={time} onChange={(t) => setTime(i, t)} invalid={!!err} label={`Match ${i + 1} start time`} />
                </div>
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <DoorOpen className="size-3" /> IDP (room ID &amp; password)
                  </p>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(idp)}
                      onValueChange={(v) => onChange({ ...value, idpMinutes: idpMinutes.map((x, k) => (k === i ? Number(v) : x)) })}
                    >
                      <SelectTrigger aria-label={`Match ${i + 1} IDP time`} className="h-10 w-36 bg-background/80 font-semibold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(IDPS.includes(idp) ? IDPS : [...IDPS, idp].sort((a, b) => a - b)).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n === 0 ? "At start" : `${n} min before`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="font-display text-sm font-bold text-muted-foreground">{formatTime(addMinutesToTime(time, -idp))}</span>
                  </div>
                </div>
              </div>
              {err && <p className="mt-2 text-sm font-medium text-destructive sm:pl-12">{err}</p>}
            </li>
          );
        })}
      </ol>

      {maps.length < MAX_MATCHES && (
        <Button type="button" variant="outline" className="h-11 w-full border-dashed" onClick={() => setCount(maps.length + 1)}>
          <Plus /> Add match {maps.length + 1}
        </Button>
      )}
    </div>
  );
}

/** When registration closes: when match 1 starts, or a few minutes before it. */
export function RegistrationClosePicker({ value, onChange, firstStart }: {
  value: number;
  onChange: (minutes: number) => void;
  /** match 1's "HH:mm" */
  firstStart: string;
}) {
  const before = value > 0;
  const options = [
    { key: "start", active: !before, title: "When match 1 starts", text: `Teams can join until ${formatTime(firstStart)}.`, pick: () => onChange(0) },
    { key: "before", active: before, title: "Before match 1", text: "Gives you time to set up the lobby.", pick: () => !before && onChange(30) },
  ];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="When registration closes" className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={o.active}
            onClick={o.pick}
            className={cn(
              "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors",
              o.active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span className={cn("mt-0.5 size-4 shrink-0 rounded-full border-2", o.active ? "border-primary bg-primary" : "border-input")} />
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="block text-sm text-muted-foreground">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
      {before && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
            <SelectTrigger aria-label="Minutes before match 1" className="h-10 w-40 font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(CLOSE_BEFORE.includes(value) ? CLOSE_BEFORE : [...CLOSE_BEFORE, value].sort((a, b) => a - b)).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} min before
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="size-3.5" /> Closes at <span className="font-display font-bold text-foreground">{formatTime(addMinutesToTime(firstStart, -value))}</span>
          </span>
        </div>
      )}
    </div>
  );
}

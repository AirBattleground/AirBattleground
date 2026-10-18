import { CalendarOff, Clock, MonitorPlay, Plus, Trash2, X } from "lucide-react";
import type { ScheduleConfig } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { formatDate, formatTime } from "@/features/manager/format";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { Stepper } from "@/features/manager/components/Stepper";
import { addMinutes, toMinutes } from "../format";
import { Advanced, Field } from "./form";

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`).concat("23:59");

export function TimePick({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  const opts = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} aria-invalid={invalid || undefined} className="h-10 w-full min-w-28 font-display text-base font-bold sm:w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {opts.map((t) => (
          <SelectItem key={t} value={t}>
            {formatTime(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ScheduleErrors {
  startDate?: string;
  endDate?: string;
  windows?: string;
}

/** Inputs for one stage's schedule: dates, daily time windows, days off, lobbies (+ match length & break under Advanced). */
export function ScheduleEditor({ value, onChange, errors, minDate, disabled }: {
  value: ScheduleConfig;
  onChange: (next: ScheduleConfig) => void;
  errors?: ScheduleErrors;
  minDate?: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<ScheduleConfig>) => onChange({ ...value, ...patch });
  const setWindow = (i: number, patch: Partial<{ start: string; end: string }>) =>
    set({ windows: value.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const addWindow = () => {
    const last = value.windows[value.windows.length - 1];
    const start = last ? addMinutes(last.end, 60) : "18:00";
    set({ windows: [...value.windows, { start, end: addMinutes(start, 180) }] });
  };
  const inRange = (d: string) => d >= value.startDate && d <= value.endDate;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 disabled:opacity-60">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" error={errors?.startDate}>
          <DatePickerButton
            value={value.startDate}
            onChange={(d) => set({ startDate: d, endDate: value.endDate < d ? d : value.endDate })}
            className="h-11 w-full"
            invalid={!!errors?.startDate}
            isDisabled={minDate ? (d) => d < minDate : undefined}
          />
        </Field>
        <Field label="Last day" error={errors?.endDate} hint="Matches only run on days in this range.">
          <DatePickerButton
            value={value.endDate}
            onChange={(d) => set({ endDate: d })}
            className="h-11 w-full"
            invalid={!!errors?.endDate}
            isDisabled={(d) => d < value.startDate}
          />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-primary" /> Playing hours each day <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">IST</span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={addWindow} disabled={value.windows.length >= 4}>
            <Plus /> Add hours
          </Button>
        </div>
        <ul className="space-y-2">
          {value.windows.map((w, i) => {
            const bad = toMinutes(w.end) <= toMinutes(w.start);
            const hours = Math.max(0, toMinutes(w.end) - toMinutes(w.start)) / 60;
            return (
              <li key={i} className={cn("flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2", bad && "border-destructive/50")}>
                <TimePick value={w.start} onChange={(v) => setWindow(i, { start: v })} label={`Window ${i + 1} starts`} />
                <span className="text-sm text-muted-foreground">to</span>
                <TimePick value={w.end} onChange={(v) => setWindow(i, { end: v })} label={`Window ${i + 1} ends`} invalid={bad} />
                <span className={cn("ml-auto text-xs", bad ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {bad ? "Must end after it starts" : `${hours % 1 ? hours.toFixed(1) : hours} h`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove window ${i + 1}`}
                  disabled={value.windows.length <= 1}
                  onClick={() => set({ windows: value.windows.filter((_, j) => j !== i) })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
        {errors?.windows && <p className="mt-1.5 text-sm font-medium text-destructive">{errors.windows}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label={<span className="flex items-center gap-2"><MonitorPlay className="size-4 text-primary" /> Lobbies at the same time</span>} hint="Need more rooms and match managers, but finishes sooner.">
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(value.parallelLobbies)}
            onValueChange={(v) => v && set({ parallelLobbies: Number(v) })}
            className="w-full sm:w-auto"
          >
            {[1, 2, 3, 4].map((n) => (
              <ToggleGroupItem key={n} value={String(n)} aria-label={`${n} lobb${n === 1 ? "y" : "ies"}`} className="h-10 flex-1 px-4 font-display text-lg font-bold sm:flex-none">
                {n}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label={<span className="flex items-center gap-2"><CalendarOff className="size-4 text-primary" /> Days off</span>} optional hint="Skip these days (e.g. a festival).">
          <div className="flex flex-wrap items-center gap-1.5">
            {value.excludeDates.map((d) => (
              <span key={d} className={cn("inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs font-medium", !inRange(d) && "opacity-50")}>
                {formatDate(d)}
                <button type="button" aria-label={`Remove ${formatDate(d)}`} onClick={() => set({ excludeDates: value.excludeDates.filter((x) => x !== d) })} className="rounded-full p-0.5 hover:bg-accent">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <DatePickerButton
              value={null}
              placeholder="Add a day off"
              onChange={(d) => !value.excludeDates.includes(d) && set({ excludeDates: [...value.excludeDates, d].sort() })}
              isDisabled={(d) => !inRange(d) || value.excludeDates.includes(d)}
              className="h-8 text-xs"
            />
          </div>
        </Field>
      </div>

      <Advanced title="Match length & breaks" hint={`${value.matchMinutes} min per match (incl. setup) · ${value.breakMinutes} min break`}>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Minutes per match" hint="Include lobby setup and the match itself. 40 is typical.">
            <div className="flex flex-wrap items-center gap-2">
              <Stepper value={value.matchMinutes} onChange={(n) => set({ matchMinutes: n })} min={15} max={120} suffix="min" />
              {[30, 40, 45, 60].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set({ matchMinutes: n })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", value.matchMinutes === n ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Break between matches" hint="Time between two matches of the same group.">
            <Stepper value={value.breakMinutes} onChange={(n) => set({ breakMinutes: n })} min={0} max={60} suffix="min" />
          </Field>
        </div>
      </Advanced>
    </fieldset>
  );
}

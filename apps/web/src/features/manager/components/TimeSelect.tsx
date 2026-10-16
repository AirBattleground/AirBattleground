import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { formatTime } from "../format";

const STEPS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
const QUICK = ["14:00", "16:00", "18:00", "20:00", "21:00"];

/** "HH:mm" picker in 15-minute steps, labelled like "8:00 PM", with quick picks. */
export function TimeSelect({ value, onChange, invalid, id }: { value: string | undefined; onChange: (v: string) => void; invalid?: boolean; id?: string }) {
  const options = value && !STEPS.includes(value) ? [...STEPS, value].sort() : STEPS;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined} className="h-11 w-44 font-display text-lg font-bold">
            <SelectValue placeholder="Pick a time" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {options.map((t) => (
              <SelectItem key={t} value={t}>
                {formatTime(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-bold tracking-wider text-muted-foreground">IST</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              value === t ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {formatTime(t)}
          </button>
        ))}
      </div>
    </div>
  );
}

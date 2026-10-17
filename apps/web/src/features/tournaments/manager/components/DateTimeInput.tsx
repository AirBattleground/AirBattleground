import { X } from "lucide-react";
import { todayInAppTz } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { istIso, istParts } from "../format";
import { TimePick } from "./ScheduleEditor";

/** Optional IST date + time → ISO instant (+05:30). */
export function DateTimeInput({ value, onChange, placeholder = "Pick a date", label, invalid }: {
  value: string | undefined;
  onChange: (iso: string | undefined) => void;
  placeholder?: string;
  label: string;
  invalid?: boolean;
}) {
  const parts = value ? istParts(value) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePickerButton
        value={parts?.date ?? null}
        placeholder={placeholder}
        invalid={invalid}
        onChange={(d) => onChange(istIso(d, parts?.time ?? "18:00"))}
        isDisabled={(d) => d < todayInAppTz()}
        className="h-10 min-w-40"
      />
      {parts && (
        <>
          <TimePick value={parts.time} onChange={(t) => onChange(istIso(parts.date, t))} label={`${label} time`} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Clear ${label}`} onClick={() => onChange(undefined)}>
            <X />
          </Button>
        </>
      )}
    </div>
  );
}

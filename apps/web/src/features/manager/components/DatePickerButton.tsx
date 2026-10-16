import { useState, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Calendar } from "@7xen/ui/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@7xen/ui/components/ui/popover";
import { cn } from "@7xen/ui/lib/utils";
import { formatDate, fromDateString, toDateString } from "../format";

/** A button that opens a calendar; works with "YYYY-MM-DD" strings. */
export function DatePickerButton({
  value,
  onChange,
  isDisabled,
  placeholder = "Pick a date",
  label,
  className,
  invalid,
  id,
  align = "start",
  ...rest
}: {
  value: string | null | undefined;
  onChange: (date: string) => void;
  /** return true to disable a date */
  isDisabled?: (date: string) => boolean;
  placeholder?: string;
  label?: ReactNode;
  className?: string;
  invalid?: boolean;
  id?: string;
  align?: "start" | "center" | "end";
  "data-tour"?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          className={cn("justify-start font-normal", !value && "text-muted-foreground", className)}
          {...rest}
        >
          <CalendarDays className="text-primary" />
          {label ?? (value ? formatDate(value) : placeholder)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={value ? fromDateString(value) : undefined}
          defaultMonth={value ? fromDateString(value) : undefined}
          disabled={isDisabled ? (d: Date) => isDisabled(toDateString(d)) : undefined}
          onSelect={(d) => {
            if (!d) return;
            onChange(toDateString(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

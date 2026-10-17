import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, Settings2 } from "lucide-react";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";

/** Card section with an icon badge (same look as the scrim form). */
export function Section({ icon, title, description, tour, aside, children, className }: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tour?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-tour={tour} className={cn("animate-rise rounded-xl border bg-card p-5 shadow-sm sm:p-6", className)}>
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl leading-tight font-bold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, error, hint, optional, children, className }: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={htmlFor} className="font-semibold">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertTriangle className="size-3.5 shrink-0" /> {message}
    </p>
  );
}

/** Collapsed-by-default "Advanced" panel so the simple path stays simple. */
export function Advanced({ title = "Advanced", hint, children, defaultOpen = false, className, tour }: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  tour?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div data-tour={tour} className={cn("rounded-xl border bg-muted/25", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Settings2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t px-4 pt-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Number that pops when it changes. */
export function AnimatedNumber({ value, className }: { value: number | string; className?: string }) {
  return (
    <span className={cn("relative inline-grid", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ y: -10, opacity: 0, scale: 1.25 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 10, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

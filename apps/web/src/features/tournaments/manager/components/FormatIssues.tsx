import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { FormatIssue } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

/** Format problems in plain words — errors (red) block publishing, warnings (amber) don't. */
export function FormatIssues({ issues, stageNames, okText = "This format works — every team has a path to the final.", className }: {
  issues: FormatIssue[];
  stageNames?: string[];
  okText?: string | null;
  className?: string;
}) {
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  if (!sorted.length)
    return okText ? (
      <p className={cn("flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm font-medium text-success", className)} role="status">
        <CheckCircle2 className="size-4 shrink-0" /> {okText}
      </p>
    ) : null;
  return (
    <ul className={cn("space-y-2", className)} aria-live="polite">
      <AnimatePresence initial={false}>
        {sorted.map((x) => (
          <motion.li
            key={`${x.stage}-${x.level}-${x.message}`}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm",
              x.level === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/50 bg-warning/10",
            )}
          >
            {x.level === "error" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
            )}
            <span>
              {x.stage != null && stageNames?.[x.stage] && <span className="font-semibold">{stageNames[x.stage]}: </span>}
              {x.message}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

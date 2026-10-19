import type { ReactNode } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "@7xen/shared";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";

/**
 * Puts an ApiError onto the form: `fields` go to their inputs, BGMI ID errors to `bgmiId`, team-name clashes to `name`.
 * Returns a message for anything that didn't land on an input (show it as a toast / banner), or null.
 */
export function applyApiError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[]): string | null {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  let placed = false;
  const has = (k: string): k is Path<T> => (fields as readonly string[]).includes(k);
  for (const [k, message] of Object.entries(err.fields ?? {})) {
    const key = k === "teamName" ? "name" : k;
    if (has(key)) {
      setError(key, { message });
      placed = true;
    }
  }
  const bgmi: string = "bgmiId";
  if (!placed && (err.code === "BGMI_ID_TAKEN" || err.code === "BGMI_ID_REQUIRED") && has(bgmi)) {
    setError(bgmi, { message: err.message });
    placed = true;
  }
  return placed ? null : err.message;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const BGMI_HINT = "Open BGMI → tap your profile picture → the number under your name (Character ID).";

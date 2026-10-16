import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { ApiError } from "@7xen/shared";

/**
 * Put an API error onto a react-hook-form form.
 * - VALIDATION_ERROR fields → matching form fields
 * - 409 CONFLICT → `conflict(err)` decides which field (and message) gets it
 * Anything not mapped to a field becomes a toast. Returns true if a field got the error.
 */
export function applyApiError<T extends FieldValues>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: Pick<UseFormReturn<T, any, any>, "getValues" | "setError">,
  err: unknown,
  opts: { conflict?: (err: ApiError) => { field: Path<T>; message: string } | null; fallback?: string } = {},
): boolean {
  if (!(err instanceof ApiError)) {
    toast.error(opts.fallback ?? "Something went wrong. Please try again.");
    return false;
  }
  const known = Object.keys(form.getValues());
  let mapped = false;
  if (err.fields) {
    for (const [path, message] of Object.entries(err.fields)) {
      if (known.includes(path)) {
        form.setError(path as Path<T>, { type: "server", message });
        mapped = true;
      }
    }
  }
  if (!mapped && err.code === "CONFLICT" && opts.conflict) {
    const c = opts.conflict(err);
    if (c) {
      form.setError(c.field, { type: "server", message: c.message }, { shouldFocus: true });
      mapped = true;
    }
  }
  if (!mapped) toast.error(err.message);
  return mapped;
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

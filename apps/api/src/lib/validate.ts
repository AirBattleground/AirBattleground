import type { ZodError, ZodTypeAny, z } from "zod";
import { AppError } from "./errors.js";

export function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0];
  const message = Object.keys(fields).length === 1 && first ? `Please check your input: ${first}` : "Please check the highlighted fields";
  return new AppError("VALIDATION_ERROR", message, fields);
}

/** Parse `data` with `schema`, throwing a 400 VALIDATION_ERROR on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}

import type { ComponentProps, ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@7xen/ui/components/ui/form";
import { Input } from "@7xen/ui/components/ui/input";

/** Label + input + error line, wired to react-hook-form. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  optional,
  transform,
  className,
  ...input
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  /** Transform typed value before storing (e.g. uppercase). */
  transform?: (v: string) => string;
} & Omit<ComponentProps<typeof Input>, "name" | "value" | "onChange" | "onBlur">) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
          </FormLabel>
          <FormControl>
            <Input
              {...input}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={(field.value as string | undefined) ?? ""}
              onChange={(e) => field.onChange(transform ? transform(e.target.value) : e.target.value)}
            />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

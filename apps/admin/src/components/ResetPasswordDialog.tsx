import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@7xen/ui/components/ui/form";
import { applyApiError } from "@/lib/forms";
import { generatePassword } from "@/lib/format";
import { PasswordInput } from "./PasswordInput";

export interface ResetTarget {
  id: string;
  name: string;
  username: string;
}

/** Set a new password for a login. Calls onSuccess(password) so the parent can show it once. */
export function ResetPasswordDialog({
  target,
  onClose,
  onSubmit,
  onSuccess,
}: {
  target: ResetTarget | null;
  onClose: () => void;
  onSubmit: (id: string, input: ResetPasswordInput) => Promise<unknown>;
  onSuccess: (target: ResetTarget, password: string) => void;
}) {
  const form = useForm<z.input<typeof resetPasswordSchema>, unknown, ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });
  useEffect(() => {
    if (target) form.reset({ password: generatePassword() });
  }, [target, form]);

  const submit = form.handleSubmit(async (values) => {
    if (!target) return;
    try {
      await onSubmit(target.id, values);
      onSuccess(target, values.password);
    } catch (e) {
      applyApiError(form, e);
    }
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for <strong className="text-foreground">{target?.name}</strong> (@{target?.username}). Their old password stops working right away.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <PasswordInput generator value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} />
                  </FormControl>
                  <FormDescription>We made a strong one for you. You can type your own (8+ characters).</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Set new password"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createManagerSchema, updateManagerSchema, type CreateManagerInput, type ManagerRow, type UpdateManagerInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@7xen/ui/components/ui/form";
import { PasswordInput } from "@/components/PasswordInput";
import { TextField } from "@/components/TextField";
import type { Credentials } from "@/components/CredentialsDialog";
import { applyApiError } from "@/lib/forms";
import { generatePassword, suggestUsername } from "@/lib/format";
import { useCreateManager, useUpdateManager } from "./api";

const usernameConflict = () => ({ field: "username" as const, message: "That username is already taken" });

export function CreateManagerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Credentials) => void }) {
  const create = useCreateManager();
  const form = useForm<z.input<typeof createManagerSchema>, unknown, CreateManagerInput>({
    resolver: zodResolver(createManagerSchema),
    defaultValues: { displayName: "", username: "", password: "", email: "", phone: "" },
  });
  const usernameTouched = useRef(false);

  useEffect(() => {
    if (open) {
      usernameTouched.current = false;
      form.reset({ displayName: "", username: "", password: generatePassword(), email: "", phone: "" });
    }
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const row = await create.mutateAsync(values);
      toast.success(`Manager login created for ${row.displayName}`);
      onOpenChange(false);
      onCreated({ who: row.displayName, role: "Manager", username: row.username, password: values.password, kind: "created" });
    } catch (e) {
      applyApiError(form, e, { conflict: usernameConflict });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <UserPlus className="size-5 text-primary" /> Create manager login
          </DialogTitle>
          <DialogDescription>Managers schedule scrims and approve teams. Fill this in, then send them the login details.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      placeholder="e.g. Rahul Esports"
                      onChange={(e) => {
                        field.onChange(e.target.value);
                        if (!usernameTouched.current) form.setValue("username", suggestUsername(e.target.value), { shouldValidate: form.formState.isSubmitted });
                      }}
                    />
                  </FormControl>
                  <FormDescription>Shown to teams on every scrim this manager runs.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <TextField
              control={form.control}
              name="username"
              label="Username"
              hint="Used to sign in. Lowercase letters, numbers, _ and . only."
              autoComplete="off"
              spellCheck={false}
              transform={(v) => {
                usernameTouched.current = true;
                return v.toLowerCase().replace(/\s+/g, "_");
              }}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <PasswordInput generator value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} />
                  </FormControl>
                  <FormDescription>At least 8 characters. Hit Generate for a strong one.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="email" label="Email" optional type="email" inputMode="email" placeholder="name@example.com" />
              <TextField control={form.control} name="phone" label="Phone" optional type="tel" inputMode="tel" placeholder="+91 98765 43210" />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating…" : "Create login"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function EditManagerDialog({ manager, onClose }: { manager: ManagerRow | null; onClose: () => void }) {
  const update = useUpdateManager();
  const form = useForm<z.input<typeof updateManagerSchema>, unknown, UpdateManagerInput>({
    resolver: zodResolver(updateManagerSchema),
    defaultValues: { displayName: "", email: "", phone: "" },
  });
  useEffect(() => {
    if (manager) form.reset({ displayName: manager.displayName, email: manager.email ?? "", phone: manager.phone ?? "" });
  }, [manager, form]);

  const submit = form.handleSubmit(async (values) => {
    if (!manager) return;
    try {
      await update.mutateAsync({ id: manager.id, input: values });
      toast.success("Manager details saved");
      onClose();
    } catch (e) {
      applyApiError(form, e);
    }
  });

  return (
    <Dialog open={!!manager} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Edit manager</DialogTitle>
          <DialogDescription>
            Username <span className="font-mono text-foreground">@{manager?.username}</span> can't be changed.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <TextField control={form.control} name="displayName" label="Display name" autoFocus />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="email" label="Email" optional type="email" inputMode="email" />
              <TextField control={form.control} name="phone" label="Phone" optional type="tel" inputMode="tel" />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

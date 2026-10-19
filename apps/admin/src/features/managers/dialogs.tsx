import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { updateManagerSchema, type ManagerRow, type UpdateManagerInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Form } from "@7xen/ui/components/ui/form";
import { TextField } from "@/components/TextField";
import { applyApiError } from "@/lib/forms";
import { useUpdateManager } from "./api";

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
            {manager?.username ? (
              <>
                Username <span className="font-mono text-foreground">@{manager.username}</span> can't be changed.
              </>
            ) : (
              <>Signs in with Google{manager?.orgName ? <> · {manager.orgName}</> : null}.</>
            )}
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

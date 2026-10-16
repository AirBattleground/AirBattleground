import { useEffect, useRef } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { ApiError, createTeamSchema, updateTeamSchema, type CreateTeamInput, type TeamRow, type UpdateTeamInput } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@7xen/ui/components/ui/form";
import { PasswordInput } from "@/components/PasswordInput";
import { TextField } from "@/components/TextField";
import type { Credentials } from "@/components/CredentialsDialog";
import { applyApiError } from "@/lib/forms";
import { generatePassword, suggestUsername } from "@/lib/format";
import { useCreateTeam, useUpdateTeam } from "./api";

const TEAM_TAKEN = "That team name is already taken";
const USERNAME_TAKEN = "That username is already taken";
const tagTransform = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

/** 409 on teams can be the name or the username — pick the field from the server message. */
function teamConflict(err: ApiError) {
  return /user ?name/i.test(err.message) ? { field: "username" as const, message: USERNAME_TAKEN } : { field: "teamName" as const, message: TEAM_TAKEN };
}

function TagPreview({ control }: { control: Control<z.input<typeof createTeamSchema>, unknown, CreateTeamInput> }) {
  const [name, tag] = useWatch({ control, name: ["teamName", "tag"] });
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
      <TeamAvatar name={name || "Team"} tag={tag || undefined} size="lg" />
      <div className="min-w-0">
        <div className="truncate font-display text-lg font-bold">{name || "Your team name"}</div>
        <div className="text-xs text-muted-foreground">{tag ? `[${tag}]` : "Tag shows here"} · preview</div>
      </div>
    </div>
  );
}

export function CreateTeamDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Credentials) => void }) {
  const create = useCreateTeam();
  const form = useForm<z.input<typeof createTeamSchema>, unknown, CreateTeamInput>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { teamName: "", tag: "", captainName: "", username: "", password: "", email: "", phone: "" },
  });
  const usernameTouched = useRef(false);

  useEffect(() => {
    if (open) {
      usernameTouched.current = false;
      form.reset({ teamName: "", tag: "", captainName: "", username: "", password: generatePassword(), email: "", phone: "" });
    }
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const row = await create.mutateAsync(values);
      toast.success(`Team login created for ${row.name}`);
      onOpenChange(false);
      onCreated({ who: row.name, role: "Team", username: row.username, password: values.password, kind: "created" });
    } catch (e) {
      applyApiError(form, e, { conflict: teamConflict });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Shield className="size-5 text-primary" /> Create team login
          </DialogTitle>
          <DialogDescription>Teams use this login to register for scrims and see their slots.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <TagPreview control={form.control} />
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField
                control={form.control}
                name="teamName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoFocus
                        placeholder="e.g. Soul Esports"
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          if (!usernameTouched.current) form.setValue("username", suggestUsername(e.target.value), { shouldValidate: form.formState.isSubmitted });
                        }}
                      />
                    </FormControl>
                    <FormDescription>Must be unique on 7xen.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <TextField control={form.control} name="tag" label="Tag" hint="2–5 letters" placeholder="SOUL" autoComplete="off" transform={tagTransform} maxLength={5} />
            </div>
            <TextField control={form.control} name="captainName" label="Captain name" optional placeholder="e.g. Mortal" />
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
              <TextField control={form.control} name="email" label="Email" optional type="email" inputMode="email" placeholder="team@example.com" />
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

export function EditTeamDialog({ team, onClose }: { team: TeamRow | null; onClose: () => void }) {
  const update = useUpdateTeam();
  const form = useForm<z.input<typeof updateTeamSchema>, unknown, UpdateTeamInput>({
    resolver: zodResolver(updateTeamSchema),
    defaultValues: { teamName: "", tag: "", captainName: "", email: "", phone: "" },
  });
  useEffect(() => {
    if (team) form.reset({ teamName: team.name, tag: team.tag, captainName: team.captainName ?? "", email: team.email ?? "", phone: team.phone ?? "" });
  }, [team, form]);

  const submit = form.handleSubmit(async (values) => {
    if (!team) return;
    try {
      await update.mutateAsync({ id: team.id, input: values });
      toast.success("Team details saved");
      onClose();
    } catch (e) {
      applyApiError(form, e, { conflict: () => ({ field: "teamName", message: TEAM_TAKEN }) });
    }
  });

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Edit team</DialogTitle>
          <DialogDescription>
            Username <span className="font-mono text-foreground">@{team?.username}</span> can't be changed.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <TextField control={form.control} name="teamName" label="Team name" autoFocus />
              <TextField control={form.control} name="tag" label="Tag" transform={tagTransform} maxLength={5} />
            </div>
            <TextField control={form.control} name="captainName" label="Captain name" optional />
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

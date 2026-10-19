import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Hash, Loader2, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { bgmiIdSchema, createPlayerTeamSchema, updatePlayerTeamSchema } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { usePlayerSession } from "@/lib/auth";
import { useCreateTeam, useUpdateProfile, useUpdateTeam } from "../api";
import { applyApiError, BGMI_HINT, Field } from "../forms";

const createSchema = createPlayerTeamSchema.extend({ bgmiId: z.union([bgmiIdSchema, z.literal("")]) });
type CreateValues = z.input<typeof createSchema>;

/** Name + tag (+ BGMI ID when the player hasn't added one yet). The creator becomes the leader. */
export function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { player } = usePlayerSession();
  const needsBgmi = !player?.bgmiId;
  const create = useCreateTeam();
  const updateProfile = useUpdateProfile();
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { name: "", tag: "", bgmiId: "" } });
  const { register, handleSubmit, setError, formState, watch, reset } = form;
  const name = watch("name");
  const tag = watch("tag");

  useEffect(() => {
    if (open) reset({ name: "", tag: "", bgmiId: "" });
  }, [open, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      if (needsBgmi) {
        if (!v.bgmiId) return setError("bgmiId", { message: "Add your BGMI ID to create a team." });
        await updateProfile.mutateAsync({ bgmiId: v.bgmiId });
      }
      const team = await create.mutateAsync({ name: v.name, tag: v.tag });
      toast.success(`${team.name} is ready!`, { description: "Share your invite link so your squad can join." });
      onOpenChange(false);
    } catch (e) {
      const left = applyApiError(e, setError, ["name", "tag", "bgmiId"]);
      if (left) toast.error("Couldn't create the team", { description: left });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Sparkles className="size-5 text-primary" /> Create your team
          </DialogTitle>
          <DialogDescription>You'll be the team leader — you register for scrims and approve new players.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <TeamAvatar name={name || "Team"} tag={(tag || "").toUpperCase() || undefined} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-xl leading-tight font-bold uppercase">{name || "Your team name"}</p>
            <p className="font-mono text-xs tracking-[0.3em] text-primary">[{(tag || "TAG").toUpperCase()}]</p>
          </div>
        </div>
        <form id="create-team" onSubmit={submit} noValidate className="space-y-4">
          <Field id="team-name" label="Team name" error={formState.errors.name?.message}>
            <Input id="team-name" autoFocus maxLength={40} placeholder="e.g. Night Owls Esports" className="h-11" aria-invalid={!!formState.errors.name} {...register("name")} />
          </Field>
          <Field id="team-tag" label="Tag" error={formState.errors.tag?.message} hint="2–5 letters or numbers, shown as [TAG].">
            <Input id="team-tag" maxLength={5} placeholder="NOX" className="h-11 font-mono tracking-[0.2em] uppercase" aria-invalid={!!formState.errors.tag} {...register("tag")} />
          </Field>
          {needsBgmi && (
            <Field id="team-bgmi" label="Your BGMI ID" error={formState.errors.bgmiId?.message} hint={BGMI_HINT}>
              <div className="relative">
                <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="team-bgmi" inputMode="numeric" placeholder="5123456789" className="h-11 pl-9 font-mono tracking-wider" aria-invalid={!!formState.errors.bgmiId} {...register("bgmiId")} />
              </div>
            </Field>
          )}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button type="submit" form="create-team" size="lg" disabled={formState.isSubmitting} className="shadow-glow">
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Shield />} Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EditValues = z.input<typeof updatePlayerTeamSchema>;

/** Leader: rename / change tag. */
export function EditTeamDialog({ open, onOpenChange, team }: { open: boolean; onOpenChange: (o: boolean) => void; team: { name: string; tag: string } }) {
  const update = useUpdateTeam();
  const form = useForm<EditValues>({ resolver: zodResolver(updatePlayerTeamSchema), defaultValues: team });
  const { register, handleSubmit, setError, formState, reset } = form;
  const { name, tag } = team;
  useEffect(() => {
    if (open) reset({ name, tag });
  }, [open, reset, name, tag]);
  const submit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ name: v.name, tag: v.tag });
      onOpenChange(false);
    } catch (e) {
      const left = applyApiError(e, setError, ["name", "tag"]);
      if (left) toast.error("Couldn't save", { description: left });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Edit team</DialogTitle>
          <DialogDescription>Organisers and other teams see this name and tag.</DialogDescription>
        </DialogHeader>
        <form id="edit-team" onSubmit={submit} noValidate className="space-y-4">
          <Field id="edit-name" label="Team name" error={formState.errors.name?.message}>
            <Input id="edit-name" maxLength={40} className="h-11" aria-invalid={!!formState.errors.name} {...register("name")} />
          </Field>
          <Field id="edit-tag" label="Tag" error={formState.errors.tag?.message} hint="2–5 letters or numbers.">
            <Input id="edit-tag" maxLength={5} className="h-11 font-mono tracking-[0.2em] uppercase" aria-invalid={!!formState.errors.tag} {...register("tag")} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-team" disabled={formState.isSubmitting}>
            {formState.isSubmitting && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

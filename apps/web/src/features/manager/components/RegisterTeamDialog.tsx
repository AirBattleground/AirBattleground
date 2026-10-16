import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { CheckCircle2, Copy, Eye, EyeOff, Loader2, RefreshCw, ShieldPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, createTeamSchema, type AvailabilityResult, type CreateTeamInput, type TeamRequestRow } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";
import { generatePassword, suggestUsername, useCreateTeamRequest, useTeamAvailability } from "../teamRequests";

type FormIn = z.input<typeof createTeamSchema>;
const EMPTY: FormIn = { teamName: "", tag: "", captainName: "", username: "", password: "", email: "", phone: "" };

function Availability({ result, checking }: { result?: AvailabilityResult; checking: boolean }) {
  if (checking) return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking" />;
  if (!result) return null;
  return result.available ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
      <CheckCircle2 className="size-4" /> Available
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
      <XCircle className="size-4" /> {result.message}
    </span>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs font-medium text-destructive">{msg}</p> : null;
}

export function RegisterTeamDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (row: TeamRequestRow, password: string) => void;
}) {
  const create = useCreateTeamRequest();
  const form = useForm<FormIn, unknown, CreateTeamInput>({ resolver: zodResolver(createTeamSchema), defaultValues: EMPTY });
  const { register, setValue, formState: { errors, isSubmitting } } = form;
  const [teamName, username, tag] = useWatch({ control: form.control, name: ["teamName", "username", "tag"] });
  const usernameTouched = useRef(false);
  const [showPw, setShowPw] = useState(true);
  const availability = useTeamAvailability(teamName ?? "", username ?? "");
  const checking = availability.isFetching;

  useEffect(() => {
    if (!open) return;
    usernameTouched.current = false;
    form.reset({ ...EMPTY, password: generatePassword() });
  }, [open, form]);

  const nameTaken = availability.data?.teamName?.available === false;
  const userTaken = availability.data?.username?.available === false;

  const submit = form.handleSubmit(async (values) => {
    try {
      const row = await create.mutateAsync(values);
      onOpenChange(false);
      onCreated(row, values.password);
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        for (const [k, msg] of Object.entries(e.fields)) form.setError(k as keyof FormIn, { type: "server", message: msg });
      } else toast.error(e instanceof ApiError ? e.message : "Couldn't send the request. Please try again.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <ShieldPlus className="size-5 text-primary" /> Register a team
          </DialogTitle>
          <DialogDescription>The admin checks every new team. The login starts working as soon as it's approved.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
            <TeamAvatar name={teamName || "Team"} tag={tag || undefined} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-bold">{teamName || "Your team name"}</div>
              <div className="text-xs text-muted-foreground">{tag ? `[${tag}]` : "Tag shows here"} · preview</div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="rt-name">Team name</Label>
                {(teamName ?? "").trim().length >= 2 && <Availability result={availability.data?.teamName} checking={checking} />}
              </div>
              <Input
                id="rt-name"
                autoFocus
                placeholder="e.g. Hydra Esports"
                aria-invalid={!!errors.teamName || nameTaken}
                {...register("teamName", {
                  onChange: (e) => {
                    if (!usernameTouched.current) setValue("username", suggestUsername(e.target.value));
                  },
                })}
              />
              <FieldError msg={errors.teamName?.message} />
              {!errors.teamName && <p className="text-xs text-muted-foreground">Must be unique on 7xen — no two teams can share a name.</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rt-tag">Tag</Label>
              <Input
                id="rt-tag"
                placeholder="HYD"
                maxLength={5}
                autoComplete="off"
                aria-invalid={!!errors.tag}
                {...register("tag", { onChange: (e) => setValue("tag", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)) })}
              />
              <FieldError msg={errors.tag?.message} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rt-captain">
              Captain name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="rt-captain" placeholder="e.g. Mortal" {...register("captainName")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="rt-user">Username</Label>
                {(username ?? "").trim().length >= 3 && <Availability result={availability.data?.username} checking={checking} />}
              </div>
              <Input
                id="rt-user"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!errors.username || userTaken}
                {...register("username", {
                  onChange: (e) => {
                    usernameTouched.current = true;
                    setValue("username", e.target.value.toLowerCase().replace(/\s+/g, "_"));
                  },
                })}
              />
              <FieldError msg={errors.username?.message} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rt-pw">Password</Label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input id="rt-pw" type={showPw ? "text" : "password"} className="pr-9 font-mono" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" size="icon" title="Generate a new password" onClick={() => setValue("password", generatePassword(), { shouldValidate: true })}>
                  <RefreshCw />
                </Button>
              </div>
              <FieldError msg={errors.password?.message} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rt-email">
                Email <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="rt-email" type="email" inputMode="email" placeholder="team@example.com" aria-invalid={!!errors.email} {...register("email")} />
              <FieldError msg={errors.email?.message} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rt-phone">
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="rt-phone" type="tel" inputMode="tel" placeholder="+91 98765 43210" {...register("phone")} />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || nameTaken || userTaken}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <ShieldPlus />} Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shown once after submitting: the login details to pass on to the team. */
export function RequestSentDialog({ sent, onClose }: { sent: { row: TeamRequestRow; password: string } | null; onClose: () => void }) {
  const message = sent
    ? `7XEN team login for ${sent.row.teamName}\nPortal: ${window.location.origin}\nUsername: ${sent.row.username}\nPassword: ${sent.password}\n(Works once the 7XEN admin approves the team.)`
    : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Login details copied");
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  };
  return (
    <Dialog open={!!sent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Sent to the admin</DialogTitle>
          <DialogDescription>
            {sent?.row.teamName} will be able to log in once the admin approves it. Save these details now — the password isn't shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {[
            ["Username", sent?.row.username ?? ""],
            ["Password", sent?.password ?? ""],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className={cn("font-mono text-base select-all")}>{value}</div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button onClick={copy}>
            <Copy /> Copy login details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

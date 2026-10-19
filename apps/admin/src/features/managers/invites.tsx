import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Copy, Mail, MailPlus, MessageCircle, RefreshCw, Send, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { createManagerInviteSchema, managerInviteMessage, type CreateManagerInviteInput, type ManagerInviteRow } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Form } from "@7xen/ui/components/ui/form";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { TextField } from "@/components/TextField";
import { applyApiError, errorMessage } from "@/lib/forms";
import { copyText, PORTAL_URL, relativeTime } from "@/lib/format";
import { useCreateManagerInvite, useManagerInvites, useRevokeManagerInvite } from "./api";

type InviteLike = Pick<ManagerInviteRow, "name" | "orgName" | "email">;

/** mailto / WhatsApp / plain text for an invitation. */
function inviteLinks(invite: InviteLike) {
  const { subject, body } = managerInviteMessage(invite, PORTAL_URL);
  return {
    mailto: `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(body)}`,
    text: `${subject}\n\n${body}`,
  };
}

/** Send email · WhatsApp · Copy message. `compact` = small buttons for list rows. */
export function SendInviteActions({ invite, compact, className }: { invite: InviteLike; compact?: boolean; className?: string }) {
  const links = inviteLinks(invite);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const size = compact ? "sm" : "lg";
  const copy = async () => {
    if (await copyText(links.text)) {
      setCopied(true);
      toast.success("Invite message copied");
    } else toast.error("Couldn't copy. Use Send email or WhatsApp instead.");
  };
  return (
    <div className={cn(compact ? "flex flex-wrap gap-2" : "grid gap-2 sm:grid-cols-3", className)}>
      <Button asChild size={size} variant={compact ? "outline" : "default"} className={compact ? "" : "shadow-glow"}>
        <a href={links.mailto}>
          <Mail /> {compact ? "Email" : "Send email"}
        </a>
      </Button>
      <Button asChild size={size} variant="outline">
        <a href={links.whatsapp} target="_blank" rel="noreferrer">
          <MessageCircle /> WhatsApp
        </a>
      </Button>
      <Button type="button" size={size} variant="outline" onClick={copy}>
        {copied ? <Check className="text-success" /> : <Copy />} {compact ? "Copy" : "Copy message"}
      </Button>
    </div>
  );
}

const EMPTY: CreateManagerInviteInput = { name: "", orgName: "", email: "" };

/** Two steps: details → "Send the invite". */
export function InviteManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateManagerInvite();
  const [sent, setSent] = useState<ManagerInviteRow | null>(null);
  const form = useForm<z.input<typeof createManagerInviteSchema>, unknown, CreateManagerInviteInput>({
    resolver: zodResolver(createManagerInviteSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) {
      setSent(null);
      form.reset(EMPTY);
    }
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const row = await create.mutateAsync(values);
      toast.success(`Invitation created for ${row.name}`);
      setSent(row);
    } catch (e) {
      applyApiError(form, e, { conflict: (err) => ({ field: "email", message: err.message }) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => sent && e.preventDefault()}>
        {!sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display text-2xl">
                <MailPlus className="size-5 text-primary" /> Invite manager
              </DialogTitle>
              <DialogDescription>They sign in with Google using this email and land straight on their organiser dashboard. No password needed.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={submit} className="grid gap-4" noValidate>
                <TextField control={form.control} name="name" label="Name" autoFocus placeholder="e.g. Rahul Sharma" autoComplete="off" />
                <TextField control={form.control} name="orgName" label="Organisation name" placeholder="e.g. Rahul Esports" hint="Shown to teams on every scrim they run." autoComplete="off" />
                <TextField control={form.control} name="email" label="Email" type="email" inputMode="email" placeholder="name@gmail.com" hint="The Google account they'll sign in with." autoComplete="off" spellCheck={false} />
                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? "Creating…" : "Create invitation"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        ) : (
          <>
            <DialogHeader>
              <motion.div
                initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="mx-auto mb-1 flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success sm:mx-0"
              >
                <Send className="size-7" />
              </motion.div>
              <DialogTitle className="font-display text-2xl">Send the invite</DialogTitle>
              <DialogDescription>
                {sent.name} ({sent.orgName}) becomes a manager the first time they sign in with Google as <span className="font-medium text-foreground">{sent.email}</span>. Let them know:
              </DialogDescription>
            </DialogHeader>
            <SendInviteActions invite={sent} />
            <p className="text-xs text-muted-foreground">You'll find it under Pending invitations until they sign in.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeInviteDialog({ invite, onClose }: { invite: ManagerInviteRow | null; onClose: () => void }) {
  const revoke = useRevokeManagerInvite();
  return (
    <AlertDialog open={!!invite} onOpenChange={(o) => !o && !revoke.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">Revoke {invite?.name}'s invitation?</AlertDialogTitle>
          <AlertDialogDescription>
            Signing in as {invite?.email} won't make them a manager any more. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={async () => {
              if (!invite) return;
              try {
                await revoke.mutateAsync(invite.id);
                toast.success(`Invitation for ${invite.name} revoked`);
                onClose();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {revoke.isPending ? "Revoking…" : "Revoke invitation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Pending invitations" section on the Managers page. */
export function PendingInvites({ className }: { className?: string }) {
  const list = useManagerInvites();
  const [revoking, setRevoking] = useState<ManagerInviteRow | null>(null);
  const items = list.data?.items ?? [];

  return (
    <section className={cn("space-y-3", className)} data-tour="pending-invites" aria-labelledby="pending-invites-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="pending-invites-title" className="font-display text-lg font-semibold">
          Pending invitations
        </h2>
        {items.length > 0 && <span className="text-sm text-muted-foreground">{items.length} waiting</span>}
      </div>
      {list.isPending ? (
        <div className="grid gap-2" aria-busy aria-label="Loading">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">Couldn't load invitations. {errorMessage(list.error)}</span>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : !items.length ? (
        <p className="rounded-xl border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
          No invitations waiting. Use <span className="font-medium text-foreground">Invite manager</span> — invites stay here until the person signs in with Google.
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.map((inv, i) => (
            <motion.li
              key={inv.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.03 }}
              className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <TeamAvatar name={inv.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {inv.name} <span className="font-normal text-muted-foreground">· {inv.orgName}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {inv.email} · Invited {relativeTime(inv.createdAt).toLowerCase()}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SendInviteActions invite={inv} compact />
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setRevoking(inv)}>
                  <Trash2 /> Revoke
                </Button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      <RevokeInviteDialog invite={revoking} onClose={() => setRevoking(null)} />
    </section>
  );
}

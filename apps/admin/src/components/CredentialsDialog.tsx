import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, MessageCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { copyText, loginDetailsMessage, PORTAL_URL } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export interface Credentials {
  who: string;
  role: "Manager" | "Team";
  username: string;
  password: string;
  /** "created" (new login) or "reset" (new password) */
  kind: "created" | "reset";
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={mono ? "truncate font-mono text-base select-all" : "truncate text-sm select-all"}>{value}</div>
      </div>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} size="icon-sm" />
    </div>
  );
}

/** Shows a login's username/password exactly once, with a WhatsApp-ready "Copy login details". */
export function CredentialsDialog({ credentials, onClose }: { credentials: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [credentials]);
  const c = credentials;
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        {c && (
          <>
            <DialogHeader>
              <motion.div
                initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="mx-auto mb-1 flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success sm:mx-0"
              >
                <KeyRound className="size-7" />
              </motion.div>
              <DialogTitle className="font-display text-2xl">{c.kind === "created" ? "Credentials ready" : "New password ready"}</DialogTitle>
              <DialogDescription>
                {c.kind === "created" ? `${c.role} login for ${c.who} is live.` : `${c.who} can now sign in with this new password.`} Send these details to them.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Row label="Portal" value={PORTAL_URL} />
              <Row label="Username" value={c.username} mono />
              <Row label="Password" value={c.password} mono />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                <strong>This password is shown only once.</strong> Copy it now — you can always reset it later if it gets lost.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {copied ? "Done" : "I've saved it"}
              </Button>
              <Button
                autoFocus
                onClick={async () => {
                  const ok = await copyText(loginDetailsMessage(c));
                  if (ok) {
                    setCopied(true);
                    toast.success("Login details copied — paste them in WhatsApp");
                  } else toast.error("Couldn't copy. Select the details and copy them manually.");
                }}
              >
                <MessageCircle /> Copy login details
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

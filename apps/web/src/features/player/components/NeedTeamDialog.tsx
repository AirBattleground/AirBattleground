import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Crown, Hash, Hourglass, KeyRound, Loader2, Megaphone, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { ApiError, INVITE_CODE_LENGTH, bgmiIdSchema, normalizeInviteCode, type PlayerTeam } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { useCreateJoinRequest, useInvitePreview, usePlayerProfile, useUpdateProfile } from "../api";
import { BGMI_HINT, Field } from "../forms";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { PendingJoinCard } from "./NoTeamHome";

type Step = "choose" | "join" | "sent";

/**
 * Phase 5c: a player without a team tapped Register (or the home "team up" banner).
 * Two choices: create a team (then `onTeamCreated` continues the registration) or join one with a code
 * (inline: code → team preview → request; the leader approves, then the player can “Ask my leader”).
 */
export function NeedTeamDialog({
  open,
  onOpenChange,
  what,
  onTeamCreated,
  title = "You need a team to register",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** what they wanted to register for, e.g. "this scrim" */
  what?: string;
  onTeamCreated?: (team: PlayerTeam) => void;
  title?: string;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [createOpen, setCreateOpen] = useState(false);
  const profile = usePlayerProfile({ enabled: open });
  const pending = profile.data?.pendingJoinRequest ?? null;

  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);

  const target = what ?? "scrims and tournaments";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-tour="need-team">
          {step === "sent" ? (
            <SentView what={target} onDone={() => onOpenChange(false)} />
          ) : step === "join" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Join with a code</DialogTitle>
                <DialogDescription>Type the 8-character code from your team leader, or paste their invite link.</DialogDescription>
              </DialogHeader>
              {pending ? (
                <div className="space-y-3">
                  <PendingJoinCard request={pending} />
                  <p className="text-sm text-muted-foreground">
                    You can have one request at a time. Once the leader approves, tap <span className="font-semibold text-foreground">“Ask my leader”</span> on {target} and they register the team.
                  </p>
                </div>
              ) : (
                <InlineJoin onSent={() => setStep("sent")} />
              )}
              <Button variant="ghost" className="self-start text-muted-foreground" onClick={() => setStep("choose")}>
                <ArrowLeft /> Back
              </Button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
                <DialogDescription>Scrims and tournaments are played as a team. Make your own in a few seconds, or join your friends'.</DialogDescription>
              </DialogHeader>
              {pending && <PendingJoinCard request={pending} />}
              <div className="grid gap-3">
                <Choice
                  icon={<Shield />}
                  primary
                  title="Create a team"
                  text={onTeamCreated ? "You'll be the leader, and we'll take you straight back to registering." : "You'll be the leader and get an invite link for your squad."}
                  onClick={() => {
                    onOpenChange(false);
                    setCreateOpen(true);
                  }}
                  tour="need-team-create"
                />
                <Choice
                  icon={<Users />}
                  title="Join with a code"
                  text={pending ? `You already asked to join ${pending.team.name}.` : "Got an invite from a friend? Ask to join their team."}
                  onClick={() => setStep("join")}
                  tour="need-team-join"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onTeamCreated}
        description={onTeamCreated ? `You'll be the team leader. Right after this you can register for ${target}.` : undefined}
      />
    </>
  );
}

function Choice({ icon, title, text, onClick, primary, tour }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; primary?: boolean; tour?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tour}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border p-4 text-left outline-none transition-all hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        primary ? "border-primary/50 bg-primary/10 hover:shadow-glow" : "bg-card hover:border-primary/40",
      )}
    >
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", primary ? "bg-primary text-primary-foreground shadow-glow" : "bg-primary/15 text-primary")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg leading-tight font-bold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

/** Code (or pasted link) → team preview → "Send join request" (asks the BGMI ID first if missing). */
function InlineJoin({ onSent }: { onSent: () => void }) {
  const { player } = usePlayerSession();
  const [value, setValue] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [bgmi, setBgmi] = useState("");
  const [bgmiError, setBgmiError] = useState<string | null>(null);
  const invite = useInvitePreview(code ?? undefined, !!code);
  const join = useCreateJoinRequest();
  const update = useUpdateProfile();
  const needsBgmi = !player?.bgmiId;
  const busy = join.isPending || update.isPending;

  const lookUp = () => {
    const fromLink = value.match(/\/join\/([^/?#\s]+)/i)?.[1];
    const c = normalizeInviteCode(fromLink ?? value);
    if (c.length !== INVITE_CODE_LENGTH) return setCodeError(`Invite codes are ${INVITE_CODE_LENGTH} letters/numbers — or paste the whole link.`);
    setCode(c);
  };

  const send = async () => {
    if (!code) return;
    try {
      if (needsBgmi) {
        const parsed = bgmiIdSchema.safeParse(bgmi);
        if (!parsed.success) return setBgmiError(bgmi ? (parsed.error.issues[0]?.message ?? "Check your BGMI ID") : "Add your BGMI ID first — teams need it for results.");
        await update.mutateAsync({ bgmiId: parsed.data });
      }
      await join.mutateAsync({ code });
      onSent();
    } catch (e) {
      if (e instanceof ApiError && e.fields?.bgmiId) return setBgmiError(e.fields.bgmiId);
      if (e instanceof ApiError && e.code === "BGMI_ID_TAKEN") return setBgmiError(e.message);
      toast.error("Couldn't send your request", { description: e instanceof ApiError ? e.message : "Please try again." });
      void invite.refetch();
    }
  };

  const t = invite.data;
  const invalid = invite.isError;

  return (
    <div className="space-y-3">
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          lookUp();
        }}
      >
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <KeyRound aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Invite code or link"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setCodeError(null);
                setCode(null);
              }}
              placeholder="Invite code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 rounded-xl pl-9 font-mono tracking-wider"
              aria-invalid={!!codeError}
            />
          </div>
          <Button type="submit" variant="outline" className="h-11 rounded-xl px-4" disabled={invite.isFetching}>
            {invite.isFetching ? <Loader2 className="animate-spin" /> : "Find team"}
          </Button>
        </div>
        {codeError && <p className="text-xs font-medium text-destructive">{codeError}</p>}
        {invalid && <p className="text-xs font-medium text-destructive">That code doesn't work. Ask your leader for their latest invite link.</p>}
      </form>

      {t && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-muted/40 p-3">
          <div className="flex items-center gap-3">
            <TeamAvatar name={t.team.name} tag={t.team.tag} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg leading-tight font-bold uppercase">{t.team.name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Crown className="size-3 text-warning" /> {t.leader.ign ?? t.leader.displayName} · {t.memberCount}/{t.maxMembers} players
              </p>
            </div>
          </div>
          {t.full ? (
            <p className="text-sm font-medium text-warning">This team is full. Ask the leader to make room, or create your own team.</p>
          ) : (
            <>
              {needsBgmi && (
                <Field id="join-bgmi" label="Your BGMI ID" error={bgmiError ?? undefined} hint={BGMI_HINT}>
                  <div className="relative">
                    <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="join-bgmi"
                      inputMode="numeric"
                      placeholder="5123456789"
                      value={bgmi}
                      onChange={(e) => {
                        setBgmi(e.target.value);
                        setBgmiError(null);
                      }}
                      className="h-11 pl-9 font-mono tracking-wider"
                      aria-invalid={!!bgmiError}
                    />
                  </div>
                </Field>
              )}
              <Button size="lg" className="h-11 w-full text-base shadow-glow" disabled={busy} onClick={() => void send()}>
                {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Ask to join {t.team.name}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SentView({ what, onDone }: { what: string; onDone: () => void }) {
  return (
    <>
      <DialogHeader>
        <span className="flex size-12 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Hourglass className="size-6" />
        </span>
        <DialogTitle className="font-display text-2xl">Request sent</DialogTitle>
        <DialogDescription>The team leader has to approve you first. We'll switch you over to your team as soon as they do.</DialogDescription>
      </DialogHeader>
      <ol className="space-y-2 text-sm">
        {[
          { icon: <Crown />, text: "Your leader approves your request." },
          { icon: <Megaphone />, text: `Tap “Ask my leader” on ${what}.` },
          { icon: <Shield />, text: "Your leader registers the team in one tap." },
        ].map((s, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary [&_svg]:size-4">{s.icon}</span>
            {s.text}
          </li>
        ))}
      </ol>
      <Button size="lg" className="w-full" onClick={onDone}>
        Got it
      </Button>
    </>
  );
}

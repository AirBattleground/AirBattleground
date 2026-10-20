import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Hourglass, KeyRound, Loader2, Shield, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { INVITE_CODE_LENGTH, normalizeInviteCode, type MyJoinRequest } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { refreshMembership, useCancelJoinRequest, usePlayerProfile } from "../api";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { MyInvitesPanel } from "./MyInvitesPanel";
import { useT } from "@/i18n/core";
import { squadMsg } from "@/i18n/team";

/** Type a code (or paste a whole invite link) → /join/:code. */
export function JoinCodeForm({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const t = useT(squadMsg);
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const fromLink = value.match(/\/join\/([^/?#\s]+)/i)?.[1];
    const code = normalizeInviteCode(fromLink ?? value);
    if (code.length !== INVITE_CODE_LENGTH) {
      setError(t("code_len_error", { n: INVITE_CODE_LENGTH }));
      return;
    }
    navigate(`/join/${code}`);
  };
  return (
    <form
      className={cn("space-y-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("code_or_link")}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={t("code_placeholder")}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 rounded-xl bg-background/60 pl-9 font-mono tracking-wider"
            aria-invalid={!!error}
          />
        </div>
        <Button type="submit" size="lg" variant="outline" className="h-12 rounded-xl px-4">
          {t("join")} <ArrowRight />
        </Button>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </form>
  );
}

/** "You asked to join X · waiting" with a cancel button. */
export function PendingJoinCard({ request, className }: { request: MyJoinRequest; className?: string }) {
  const t = useT(squadMsg);
  const cancel = useCancelJoinRequest();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center", className)}
      data-tour="pending-join"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TeamAvatar name={request.team.name} tag={request.team.tag} size="md" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-warning uppercase">
            <Hourglass className="size-3.5" /> {t("waiting_leader")}
          </p>
          <p className="truncate font-display text-lg leading-tight font-bold">{t("you_asked", { team: request.team.name })}</p>
                  </div>
      </div>
      <Button variant="ghost" size="sm" className="self-start text-muted-foreground hover:text-destructive sm:self-center" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
        {cancel.isPending ? <Loader2 className="animate-spin" /> : <X />} {t("cancel_request")}
      </Button>
    </motion.div>
  );
}

/** Polls the profile while the player has no team and flips the session over when the leader approves. */
export function useWatchForApproval() {
  const t = useT(squadMsg);
  const qc = useQueryClient();
  const { hasTeam } = usePlayerSession();
  const profile = usePlayerProfile({ poll: !hasTeam });
  const announced = useRef(false);
  const team = profile.data?.team;
  useEffect(() => {
    if (!team || hasTeam || announced.current) return;
    announced.current = true;
    toast.success(t("approved_toast", { team: team.name }), { description: t("approved_desc"), duration: 8000 });
    void refreshMembership(qc);
  }, [team, hasTeam, qc, t]);
  return profile;
}

const HOW = [
  { title: "how1_title", text: "how1_text" },
  { title: "how2_title", text: "how2_text" },
  { title: "how3_title", text: "how3_text" },
] as const;

/**
 * The full create / join UI for a player with no team. Lives on My team only (phase 5c) — everywhere else the
 * player browses freely and is asked for a team when they register.
 */
export function CreateOrJoinTeam() {
  const t = useT(squadMsg);
  const profile = useWatchForApproval();
  const [createOpen, setCreateOpen] = useState(false);
  const pending = profile.data?.pendingJoinRequest ?? null;

  return (
    <div className="space-y-6">
      <MyInvitesPanel />
      {pending && <PendingJoinCard request={pending} />}

      <div className="grid gap-4 md:grid-cols-2" data-tour="start-hero">
        <section className="flex flex-col rounded-2xl border border-primary/40 bg-card p-4 shadow-sm sm:p-5" data-tour="create-team">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            <Shield className="size-3.5" /> {t("create_title")}
          </h2>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{t("create_card_text")}</p>
          <Button size="lg" className="mt-4 h-12 w-full text-base shadow-glow" onClick={() => setCreateOpen(true)}>
            <UserPlus /> {t("create_a_team")}
          </Button>
        </section>
        <section className="flex flex-col rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-tour="join-code">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            <Users className="size-3.5" /> {t("join_code_title")}
          </h2>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{t("join_card_text", { n: INVITE_CODE_LENGTH })}</p>
          <JoinCodeForm className="mt-4" />
        </section>
      </div>

      <ol className="grid gap-x-6 gap-y-2 rounded-2xl border border-dashed p-4 text-sm sm:grid-cols-3 sm:p-5" data-tour="how-teams-work">
        {HOW.map((h, i) => (
          <li key={h.title} className="flex items-start gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-xs font-bold text-primary">{i + 1}</span>
            <span className="min-w-0">
              <span className="block font-semibold">{t(h.title)}</span>
              <span className="block text-xs text-muted-foreground">{t(h.text)}</span>
            </span>
          </li>
        ))}
      </ol>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

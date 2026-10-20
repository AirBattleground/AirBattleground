import { CheckCircle2, Crown, Loader2, Megaphone } from "lucide-react";
import type { CreateSuggestionInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { useCreateSuggestion, useTeamSuggestions } from "../api";
import { useT } from "@/i18n/core";
import { squadMsg } from "@/i18n/team";

export const scrimTarget = (scrimId: string, date: string) => `S:${scrimId}:${date}`;
export const tournamentTarget = (id: string) => `T:${id}`;

/** Keys of everything the team has already asked the leader about (OPEN suggestions). Members only. */
export function useAskedTargets() {
  const { hasTeam, isLeader } = usePlayerSession();
  const q = useTeamSuggestions("OPEN", { enabled: hasTeam && !isLeader });
  const set = new Set<string>();
  for (const s of q.data ?? []) {
    if (s.kind === "SCRIM" && s.scrim) set.add(scrimTarget(s.scrim.id, s.scrim.date));
    if (s.kind === "TOURNAMENT" && s.tournament) set.add(tournamentTarget(s.tournament.id));
  }
  return set;
}

/** "Asked · waiting for your leader" */
export function AskedPill({ by, className }: { by?: string | null; className?: string }) {
  const t = useT(squadMsg);
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm", className)}>
      <CheckCircle2 className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 leading-tight">
        <span className="block font-semibold">{t("asked_title")}</span>
        <span className="block text-xs text-muted-foreground">
          {by ? t("asked_by", { name: by }) : ""}
          {t("leader_one_tap")}
        </span>
      </span>
    </div>
  );
}

/**
 * Members' replacement for Register / Withdraw: sends the leader a suggestion.
 * Shows the "asked" state when `asked` (or the team already has an open suggestion for it).
 */
export function AskLeaderButton({
  input,
  asked,
  askedBy,
  className,
  size = "lg",
}: {
  input: CreateSuggestionInput;
  asked?: boolean;
  askedBy?: string | null;
  className?: string;
  size?: "lg" | "default";
}) {
  const t = useT(squadMsg);
  const ask = useCreateSuggestion();
  const targets = useAskedTargets();
  const key = input.kind === "SCRIM" ? scrimTarget(input.scrimId, input.date) : tournamentTarget(input.tournamentId);
  if (asked || targets.has(key) || ask.isSuccess) return <AskedPill by={askedBy} className={className} />;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button
        size={size}
        variant="outline"
        className={cn("w-full border-primary/50 font-semibold text-primary hover:bg-primary/10 hover:text-primary", size === "lg" && "h-11 text-base")}
        disabled={ask.isPending}
        onClick={() => ask.mutate(input)}
        data-tour="ask-leader"
      >
        {ask.isPending ? <Loader2 className="animate-spin" /> : <Megaphone />} {t("ask_leader")}
      </Button>
      <p className="flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
        <Crown className="size-3 text-warning" /> {t("only_leader_register")}
      </p>
    </div>
  );
}

/** Small note for members where a leader-only action (cancel, withdraw, edit) would be. */
export function LeaderOnlyNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  const t = useT(squadMsg);
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Crown className="size-3.5 shrink-0 text-warning" /> {children ?? t("only_leader_change")}
    </p>
  );
}

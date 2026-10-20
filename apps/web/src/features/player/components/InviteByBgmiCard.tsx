import { useState } from "react";
import { Check, Copy, Hash, RefreshCw, Send, Share2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, bgmiIdSchema, inviteLinkPath, type PlayerTeam } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { useInviteByBgmi, useRevokeInvite } from "../api";
import { PlayerAvatar } from "./PlayerAvatar";
import { useT } from "@/i18n/core";
import { squadMsg } from "@/i18n/team";

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8.2 8.2 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.8.4 3.5 3.5 0 0 0-1.1 2.6 6 6 0 0 0 1.3 3.2 13.9 13.9 0 0 0 5.3 4.7c2 .8 2.7.9 3.7.7.6-.1 1.8-.7 2-1.4s.3-1.3.2-1.4-.3-.2-.6-.3zM12 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8zm0-21.6A11.8 11.8 0 0 0 1.9 17.9L.2 24l6.3-1.6A11.8 11.8 0 1 0 12 .2z" />
    </svg>
  );
}

/** Leader: one card to bring players in — by BGMI ID, or by sharing the link / code. Also lists invites still waiting. */
export function InvitePlayersCard({ team, onRotate }: { team: PlayerTeam; onRotate: () => void }) {
  const t = useT(squadMsg);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const invite = useInviteByBgmi();
  const revoke = useRevokeInvite();
  const full = team.members.length >= team.maxMembers;

  const code = team.inviteCode ?? "";
  const link = `${window.location.origin}${inviteLinkPath(code)}`;
  const text = t("share_text", { team: team.name, tag: team.tag, link });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = bgmiIdSchema.safeParse(value.replace(/\s/g, ""));
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t("valid_bgmi"));
    setError(null);
    invite.mutate(
      { bgmiId: parsed.data },
      {
        onSuccess: () => setValue(""),
        onError: (err) => setError(err instanceof ApiError ? err.message : t("invite_fail")),
      },
    );
  };

  const copy = async (what: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : code);
      setCopied(what);
      toast.success(what === "link" ? t("link_copied") : t("code_copied"));
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error(t("copy_fail"), { description: t("copy_fail_desc") });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t("share_title", { team: team.name }), text, url: link });
    } catch {
      /* cancelled */
    }
  };

  return (
    <section className="rounded-2xl border border-primary/30 bg-card shadow-sm" data-tour="team-invite">
      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            <UserPlus className="size-3.5" /> {t("invite_eyebrow")}
          </h2>
          {full && <p className="mt-1 text-sm text-muted-foreground">{t("team_full_hint")}</p>}
        </div>

        {/* by BGMI ID */}
        <form onSubmit={submit} noValidate data-tour="invite-bgmi" title={t("invite_note")}>
          <label htmlFor="invite-bgmi" className="sr-only">
            {t("invite_by_bgmi")}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Hash className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="invite-bgmi"
                inputMode="numeric"
                placeholder={t("bgmi_placeholder")}
                value={value}
                disabled={full || invite.isPending}
                aria-invalid={!!error}
                onChange={(e) => {
                  setValue(e.target.value.replace(/[^\d\s]/g, ""));
                  setError(null);
                }}
                className="h-11 bg-background pl-9 font-mono"
              />
            </div>
            <Button type="submit" className="h-11" disabled={full || invite.isPending || !value.trim()}>
              <Send /> {invite.isPending ? "…" : t("invite_short")}
            </Button>
          </div>
          {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
        </form>

        {/* by link */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("or_share")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void copy("link")} className="h-10">
              {copied === "link" ? <Check /> : <Copy />} {t("copy_link")}
            </Button>
            <Button asChild variant="outline" className="h-10 border-success/40 text-success hover:bg-success/10 hover:text-success">
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                <WhatsAppIcon /> WhatsApp
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <button type="button" onClick={() => void copy("code")} className="inline-flex min-h-8 items-center gap-1.5 rounded-md outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={t("code_aria", { code })} title={link}>
              {t("code")} <span className="font-mono text-sm font-bold tracking-[0.2em] text-primary">{code}</span> {copied === "code" ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
            </button>
            <span className="flex items-center gap-2">
              {canShare && (
                <button type="button" onClick={() => void share()} aria-label={t("share_aria")} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground">
                  <Share2 className="size-3.5" />
                </button>
              )}
              <button type="button" onClick={onRotate} aria-label={t("new_code")} title={t("new_code")} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground">
                <RefreshCw className="size-3.5" />
              </button>
            </span>
          </div>
        </div>
      </div>

      {team.invites.length > 0 && (
        <div className="border-t">
          <p className="px-4 pt-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:px-5">{t("waiting_answer")}</p>
          <ul className="divide-y">
            {team.invites.map((i) => {
              const n = i.player.ign ?? i.player.displayName;
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <PlayerAvatar name={n} url={i.player.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{n}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">BGMI {i.player.bgmiId}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: i.id, name: n })}>
                    <X /> {t("take_back")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

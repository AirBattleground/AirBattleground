import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Hourglass, Search, ShieldCheck, Star, UserMinus, UserPlus, Users } from "lucide-react";
import type { ManagerTournamentDetail, TournamentEntryRow } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Pill, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { timeAgo } from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { useEntries, useRemoveEntry } from "../api";
import { InviteTeamDialog } from "./InviteTeamDialog";

/** Confirmed teams, waitlist and invites — with each team's time-slot preferences. */
export function RegistrationsTab({ t }: { t: ManagerTournamentDetail }) {
  const q = useEntries(t.id);
  const remove = useRemoveEntry(t.id);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<TournamentEntryRow | null>(null);
  const [inviting, setInviting] = useState(false);

  const slotLabel = useMemo(() => new Map(t.slotOptions.map((o) => [o.id, o.label])), [t.slotOptions]);
  const all = q.data ?? [];
  const needle = search.trim().toLowerCase();
  const visible = needle ? all.filter((e) => e.team.name.toLowerCase().includes(needle) || e.team.tag.toLowerCase().includes(needle)) : all;
  const confirmed = visible.filter((e) => e.status === "CONFIRMED" && e.type === "REGISTERED");
  const invited = visible.filter((e) => e.status === "CONFIRMED" && e.type === "INVITED");
  const waitlist = visible.filter((e) => e.status === "WAITLISTED").sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
  const canInvite = t.stages.some((s) => s.order > 1 && s.invitedSlots > 0) && t.status !== "COMPLETED" && t.status !== "CANCELLED";
  const invitedPerStage = all.reduce<Record<number, number>>((acc, e) => {
    if (e.type === "INVITED" && e.status === "CONFIRMED") acc[e.entryStage] = (acc[e.entryStage] ?? 0) + 1;
    return acc;
  }, {});
  const locked = t.status === "COMPLETED" || t.status === "CANCELLED";

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load registrations" />;

  return (
    <div className="space-y-5" data-tour="t-registrations">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a team" aria-label="Find a team" className="h-10 pl-9" />
        </div>
        {canInvite && (
          <Button variant="outline" onClick={() => setInviting(true)}>
            <UserPlus /> Invite team
          </Button>
        )}
      </div>

      {!q.data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t.status === "DRAFT" ? "Publish to start taking registrations" : "No teams yet"}
          description={t.status === "DRAFT" ? "Once published, teams sign up first-come-first-served and appear here." : "Share the tournament with teams — sign-ups appear here instantly."}
        />
      ) : (
        <>
          <Group title="Confirmed" icon={<ShieldCheck className="size-4 text-success" />} count={`${all.filter((e) => e.status === "CONFIRMED" && e.type === "REGISTERED").length}/${t.maxTeams}`}>
            {confirmed.map((e, i) => (
              <Row key={e.id} e={e} n={i + 1} slotLabel={slotLabel} onRemove={locked ? undefined : () => setRemoving(e)} />
            ))}
          </Group>
          {invited.length > 0 && (
            <Group title="Invited" icon={<Star className="size-4 text-info" />} count={String(invited.length)}>
              {invited.map((e, i) => (
                <Row key={e.id} e={e} n={i + 1} slotLabel={slotLabel} stageName={t.stages.find((s) => s.order === e.entryStage)?.name} onRemove={locked ? undefined : () => setRemoving(e)} />
              ))}
            </Group>
          )}
          <Group title="Waitlist" icon={<Hourglass className="size-4 text-warning-foreground dark:text-warning" />} count={String(waitlist.length)} hint="If a confirmed team drops out before the draw, the first team here takes the spot automatically.">
            {waitlist.length ? (
              waitlist.map((e) => <Row key={e.id} e={e} n={e.waitlistPosition ?? 0} slotLabel={slotLabel} onRemove={locked ? undefined : () => setRemoving(e)} />)
            ) : (
              <li className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">Nobody is waiting.</li>
            )}
          </Group>
        </>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.team.name ?? "this team"}?`}
        description={
          removing?.status === "CONFIRMED"
            ? "They lose their spot. If it's before the draw, the first team on the waitlist gets it automatically."
            : "They'll be taken off the waitlist."
        }
        confirmLabel="Remove team"
        destructive
        onConfirm={() => removing && remove.mutate(removing)}
      />
      {canInvite && (
        <InviteTeamDialog t={t} open={inviting} onOpenChange={setInviting} takenTeamIds={new Set(all.filter((e) => e.status === "CONFIRMED" || e.status === "WAITLISTED").map((e) => e.team.id))} invitedPerStage={invitedPerStage} />
      )}
    </div>
  );
}

function Group({ title, icon, count, hint, children }: { title: string; icon: ReactNode; count: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-bold">
          {icon} {title}
        </h3>
        <span className="font-display text-sm font-bold text-muted-foreground">{count}</span>
      </div>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  );
}

function Row({ e, n, slotLabel, stageName, onRemove }: { e: TournamentEntryRow; n: number; slotLabel: Map<string, string>; stageName?: string; onRemove?: () => void }) {
  const prefs = e.timePreferences.map((id) => slotLabel.get(id) ?? id);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className="flex items-center gap-3 rounded-xl border bg-card p-2.5 pr-2 shadow-xs sm:p-3"
    >
      <span className="w-7 shrink-0 text-center font-display text-sm font-bold text-muted-foreground tabular-nums">{n}</span>
      <TeamAvatar name={e.team.name} tag={e.team.tag} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-semibold">{e.team.name}</span>
          {e.type === "INVITED" && <Pill tone="info">Invited · {stageName ?? `stage ${e.entryStage}`}</Pill>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" /> {timeAgo(e.registeredAt)}
          </span>
          {e.entryStage === 1 && (
            <span className="truncate" title={prefs.join(" › ")}>
              {prefs.length ? `Prefers: ${prefs.slice(0, 2).join(" › ")}${prefs.length > 2 ? ` +${prefs.length - 2}` : ""}` : "Any time"}
            </span>
          )}
        </p>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${e.team.name}`} onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive">
          <UserMinus />
        </Button>
      )}
    </motion.li>
  );
}

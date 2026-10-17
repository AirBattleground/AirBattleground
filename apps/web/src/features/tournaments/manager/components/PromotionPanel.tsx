import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Ban, ChevronRight, Crown, Loader2, Lock, RotateCcw, Sparkles, TrendingUp, Undo2 } from "lucide-react";
import type { PromotionCandidate, StageDetail } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Pill, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { usePromote, usePromotion } from "../api";

/**
 * Who goes through: TOP / WILDCARD qualifiers, eliminated teams, tie warnings at the cut-off and manual overrides
 * (force in / force out). Confirming plays an "advancing" transition into the next stage.
 */
export function PromotionPanel({ stage }: { stage: StageDetail }) {
  const navigate = useNavigate();
  const tId = stage.tournament.id;
  const s = stage.stage;
  const q = usePromotion(tId, s.id, s.status === "LIVE" || s.status === "COMPLETED");
  const promote = usePromote(tId, s.id);
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [advancing, setAdvancing] = useState<null | { teams: PromotionCandidate[]; to: string; href: string }>(null);

  const { qualified, eliminated } = useMemo(() => {
    const p = q.data;
    if (!p) return { qualified: [] as (PromotionCandidate & { forced?: boolean })[], eliminated: [] as (PromotionCandidate & { forced?: boolean })[] };
    const qual = [...p.qualified.filter((c) => !exclude.includes(c.team.id)), ...p.eliminated.filter((c) => include.includes(c.team.id)).map((c) => ({ ...c, forced: true }))];
    const elim = [...p.eliminated.filter((c) => !include.includes(c.team.id)), ...p.qualified.filter((c) => exclude.includes(c.team.id)).map((c) => ({ ...c, forced: true }))];
    return { qualified: qual, eliminated: elim };
  }, [q.data, include, exclude]);

  if (s.status === "PENDING" || s.status === "DRAWN")
    return <EmptyState icon={<Lock />} title="Promotion opens once the stage is played" description="Start the stage and publish every match. Then you'll see who goes through here." />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't work out who goes through" />;
  if (!q.data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );

  const p = q.data;
  const isFinal = !p.nextStage;
  const done = s.status === "COMPLETED";
  const toggle = (id: string, list: string[], set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const overrides = include.length + exclude.length;

  const confirm = () =>
    promote.mutate(
      { include, exclude },
      {
        onSuccess: (d) => {
          const next = d.stages.find((x) => x.order === s.order + 1);
          const href = next ? `/manager/tournaments/${tId}/stages/${next.id}` : `/manager/tournaments/${tId}`;
          setAdvancing({ teams: qualified, to: next?.name ?? "Champion", href });
        },
      },
    );

  return (
    <div className="space-y-5" data-tour="t-promotion">
      {!p.ready && !done && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning-foreground dark:text-warning" /> Not ready yet
          </p>
          <ul className="mt-1 list-disc pl-6 text-sm text-foreground/80">
            {p.blockers.slice(0, 4).map((b) => (
              <li key={b}>{b}</li>
            ))}
            {p.blockers.length > 4 && <li className="list-none text-muted-foreground">…and {p.blockers.length - 4} more</li>}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">This is a preview based on the results published so far.</p>
        </div>
      )}
      {p.tiesAtCutoff.length > 0 && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning-foreground dark:text-warning" /> Tie at the cut-off
          </p>
          <ul className="mt-1 list-disc pl-6 text-sm text-foreground/80">
            {p.tiesAtCutoff.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Use “Force in” / “Force out” below to settle it your way.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <List
          title={isFinal ? "Final standings" : `Going through to the ${p.nextStage!.name}`}
          tone="success"
          icon={<TrendingUp className="size-4" />}
          rows={qualified}
          count={`${qualified.length}${p.nextStage ? ` + ${p.nextStage.invited.length} invited = ${qualified.length + p.nextStage.invited.length}` : ""}`}
          action={done ? undefined : (c) => (c.forced ? { label: "Undo", icon: <Undo2 />, run: () => toggle(c.team.id, include, setInclude) } : { label: "Force out", icon: <ArrowDownCircle />, run: () => toggle(c.team.id, exclude, setExclude) })}
          isFinal={isFinal}
        />
        {!isFinal && (
          <List
            title="Eliminated"
            tone="neutral"
            icon={<Ban className="size-4" />}
            rows={eliminated}
            count={String(eliminated.length)}
            action={done ? undefined : (c) => (c.forced ? { label: "Undo", icon: <Undo2 />, run: () => toggle(c.team.id, exclude, setExclude) } : { label: "Force in", icon: <ArrowUpCircle />, run: () => toggle(c.team.id, include, setInclude) })}
          />
        )}
      </div>

      {p.nextStage && p.nextStage.invited.length > 0 && (
        <p className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
          <span className="font-semibold">Invited straight into the {p.nextStage.name}:</span> {p.nextStage.invited.map((t) => t.name).join(", ")} — they take the top seeds.
        </p>
      )}

      {!done && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-card to-card p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold">{isFinal ? `Finish the ${s.name}` : `Send ${qualified.length} teams to the ${p.nextStage!.name}`}</p>
            <p className="text-sm text-muted-foreground">
              {overrides ? `${overrides} manual change${overrides === 1 ? "" : "s"} — any gap is filled by the next best team. ` : ""}
              {isFinal ? "Locks the final standings." : "Next-stage groups are seeded by these results (snake seeding)."}
            </p>
          </div>
          <div className="flex gap-2">
            {overrides > 0 && (
              <Button variant="ghost" onClick={() => {
                  setInclude([]);
                  setExclude([]);
                }}>
                <RotateCcw /> Reset
              </Button>
            )}
            <Button size="lg" disabled={!p.ready || promote.isPending} onClick={() => setConfirming(true)} className="shadow-glow">
              {promote.isPending ? <Loader2 className="animate-spin" /> : isFinal ? <Crown /> : <TrendingUp />}
              {isFinal ? "Confirm final results" : "Promote teams"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={isFinal ? `Confirm the ${s.name} results?` : `Promote ${qualified.length} teams to the ${p.nextStage?.name}?`}
        description={isFinal ? "The stage is locked and you can crown the champion." : "The stage is locked, the rest are eliminated, and the next stage is seeded. This can't be undone."}
        confirmLabel={isFinal ? "Confirm results" : "Promote"}
        onConfirm={confirm}
      />
      <AnimatePresence>{advancing && <Advancing teams={advancing.teams} to={advancing.to} onDone={() => navigate(advancing.href)} />}</AnimatePresence>
    </div>
  );
}

interface RowAction {
  label: string;
  icon: ReactNode;
  run: () => void;
}

function List({ title, tone, icon, rows, count, action, isFinal }: {
  title: string;
  tone: "success" | "neutral";
  icon: ReactNode;
  rows: (PromotionCandidate & { forced?: boolean })[];
  count: string;
  action?: (c: PromotionCandidate & { forced?: boolean }) => RowAction;
  isFinal?: boolean;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-sm", tone === "success" && "border-success/40")}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className={cn("flex items-center gap-2 font-display text-lg font-bold", tone === "success" ? "text-success" : "text-muted-foreground")}>
          {icon} {title}
        </h3>
        <span className="font-display text-sm font-bold text-muted-foreground">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nobody here.</p>
      ) : (
        <ol className="space-y-1">
          <AnimatePresence initial={false}>
            {rows.map((c, i) => {
              const a = action?.(c);
              return (
                <motion.li key={c.team.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm", c.forced && "bg-warning/10 ring-1 ring-warning/40")}>
                  <span className="w-6 shrink-0 text-center font-display font-bold text-muted-foreground tabular-nums">{isFinal ? i + 1 : c.groupRank}</span>
                  <TeamAvatar name={c.team.name} tag={c.team.tag} size="sm" className="size-7 text-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.team.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Group {c.groupName} · #{c.groupRank} · {c.totalPoints} pts · {c.pointsPerMatch.toFixed(1)}/match
                    </span>
                  </span>
                  {c.forced ? (
                    <Pill tone="warning" className="text-[10px]">
                      {tone === "success" ? "Forced in" : "Forced out"}
                    </Pill>
                  ) : c.via === "WILDCARD" ? (
                    <Pill tone="info" icon={<Sparkles className="size-3" />} className="text-[10px]">
                      Wildcard
                    </Pill>
                  ) : c.via === "TOP" ? (
                    <Pill tone="success" className="text-[10px]">
                      Top {c.groupRank}
                    </Pill>
                  ) : null}
                  {a && (
                    <Button variant="ghost" size="xs" onClick={a.run} className="shrink-0 text-muted-foreground">
                      {a.icon} <span className="hidden sm:inline">{a.label}</span>
                    </Button>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

/** Qualified teams stream into the next stage, then we move on. */
function Advancing({ teams, to, onDone }: { teams: PromotionCandidate[]; to: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const shown = teams.slice(0, 24);
  const duration = reduce ? 0.6 : 1.2 + shown.length * 0.06;
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-background/95 backdrop-blur-xl" role="status" aria-live="assertive">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative flex w-full max-w-4xl flex-col items-center gap-8 px-6 sm:flex-row sm:justify-between">
        <div className="flex max-w-xs flex-wrap justify-center gap-1.5 sm:justify-start">
          {shown.map((c, i) => (
            <motion.span
              key={c.team.id}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={reduce ? { opacity: 0 } : { opacity: [1, 1, 0], x: [0, 0, 260], y: [0, -6, 0], scale: [1, 1.1, 0.4] }}
              transition={{ duration: 1, delay: 0.4 + i * 0.06, ease: "easeIn" }}
            >
              <TeamAvatar name={c.team.name} tag={c.team.tag} size="sm" />
            </motion.span>
          ))}
          {teams.length > shown.length && <span className="self-center text-sm text-muted-foreground">+{teams.length - shown.length}</span>}
        </div>
        <ChevronRight className="hidden size-10 animate-pulse text-primary sm:block" />
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [0.8, 1, 1.06, 1], opacity: 1 }}
          transition={{ duration, times: [0, 0.2, 0.9, 1] }}
          onAnimationComplete={() => setTimeout(onDone, 500)}
          className="rounded-3xl border border-primary/50 bg-card px-8 py-6 text-center shadow-glow"
        >
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Advancing to</p>
          <p className="font-display text-4xl font-bold text-gradient-brand">{to}</p>
          <p className="mt-1 text-sm text-muted-foreground">{teams.length} teams</p>
        </motion.div>
      </div>
    </motion.div>,
    document.body,
  );
}

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Hourglass, Loader2, Lock, RotateCw, Swords, Timer, User } from "lucide-react";
import type { TeamScrimOnDate } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { useCancelRegistration, useRegister } from "../api";
import { formatTime } from "../format";
import { useNow } from "../useNow";
import { CancelDialog, RegisterDialog, type ScrimSummary } from "./ConfirmDialogs";
import { Countdown } from "./Countdown";
import { MapChips } from "./MapChips";
import { SlotsBar } from "./SlotsBar";
import { TeamStatusBadge } from "./TeamStatus";

export function ScrimCard({ item, rejectionReason, tourAnchor = false }: { item: TeamScrimOnDate; rejectionReason?: string | null; tourAnchor?: boolean }) {
  const { scrim, date, startsAt, counts, myRegistration: my } = item;
  const now = useNow(15_000);
  const started = now >= new Date(startsAt).getTime();
  const open = item.registrationOpen && !started;
  const full = counts.slotsLeft <= 0;
  const status = my?.status === "CANCELLED" ? null : (my?.status ?? null);

  const register = useRegister();
  const cancel = useCancelRegistration();
  const [regOpen, setRegOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const summary: ScrimSummary = { title: scrim.title, date, startTime: scrim.startTime, organiser: scrim.manager.displayName, maps: scrim.maps };
  const tour = (name: string) => (tourAnchor ? { "data-tour": name } : {});

  const doRegister = () => register.mutate({ scrimId: scrim.id, date });
  const doCancel = () => my && cancel.mutate({ id: my.id, wasApproved: my.status === "APPROVED", title: scrim.title });

  return (
    <article
      {...tour("scrim-card")}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-glow",
        status === "APPROVED" && "border-success/40",
        status === "PENDING" && "border-warning/40",
      )}
    >
      {/* left accent */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          status === "APPROVED" ? "bg-success" : status === "PENDING" ? "bg-warning" : open ? "bg-primary" : "bg-muted-foreground/30",
        )}
      />
      <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 md:grid-cols-[8.5rem_1fr_14rem] md:items-center md:gap-6">
        {/* time */}
        <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:justify-center">
          <div>
            <p className="font-display text-3xl leading-none font-bold tabular-nums sm:text-4xl">{formatTime(scrim.startTime)}</p>
            <p className="mt-1 text-xs font-semibold tracking-widest text-muted-foreground">IST</p>
          </div>
          <div className={cn("flex items-center gap-1.5 text-xs font-medium", open ? "text-muted-foreground" : "text-destructive")}>
            {open ? <Timer className="size-3.5 text-primary" /> : <Lock className="size-3.5" />}
            {open ? (
              <span>
                Closes in <Countdown to={startsAt} className="font-semibold text-foreground" />
              </span>
            ) : started ? (
              "Started"
            ) : (
              "Closed"
            )}
          </div>
        </div>

        {/* details */}
        <div className="min-w-0 space-y-3">
          <div>
            <h3 className="truncate font-display text-xl leading-tight font-bold sm:text-2xl">{scrim.title}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="size-3.5" /> by <span className="font-medium text-foreground">{scrim.manager.displayName}</span>
              <span className="text-border">•</span>
              <Swords className="size-3.5" /> {scrim.maps.length} {scrim.maps.length === 1 ? "match" : "matches"}
            </p>
          </div>
          <MapChips maps={scrim.maps} />
          <SlotsBar approved={counts.approved} total={scrim.slotCount} className="max-w-md" />
        </div>

        {/* single action area */}
        <div className="flex flex-col gap-2 border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6" {...tour("scrim-action")}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={status ?? (open ? "open" : "closed")}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-2"
            >
              {status === "APPROVED" && (
                <div className="flex items-center gap-3">
                  <motion.div initial={{ scale: 0.4, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 380, damping: 14 }}>
                    {my?.slotNumber != null ? <SlotChip slot={my.slotNumber} /> : <CheckCircle2 className="size-10 text-success" />}
                  </motion.div>
                  <div>
                    <p className="font-display text-xl font-bold text-success">You're in!</p>
                    <p className="text-xs text-muted-foreground">{started ? "Match in progress — good luck!" : `Be ready before ${formatTime(scrim.startTime)}`}</p>
                  </div>
                </div>
              )}
              {status === "APPROVED" && !started && (
                <Button variant="ghost" size="sm" className="self-start text-muted-foreground hover:text-destructive" onClick={() => setCancelOpen(true)}>
                  Cancel
                </Button>
              )}

              {status === "PENDING" && (
                <>
                  <div {...tour("scrim-status")}>
                    <TeamStatusBadge status="PENDING" className="px-3 py-1 text-sm" />
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Hourglass className="mt-0.5 size-3.5 shrink-0" /> The organiser will approve soon. This page updates by itself.
                  </p>
                  {!started && (
                    <Button variant="ghost" size="sm" className="self-start text-muted-foreground hover:text-destructive" onClick={() => setCancelOpen(true)}>
                      Cancel request
                    </Button>
                  )}
                </>
              )}

              {status === "REJECTED" && (
                <>
                  <TeamStatusBadge status="REJECTED" className="self-start px-3 py-1 text-sm" />
                  {rejectionReason && <p className="text-xs text-muted-foreground">Reason: “{rejectionReason}”</p>}
                  {open && (
                    <Button variant="outline" onClick={() => setRegOpen(true)} disabled={register.isPending}>
                      <RotateCw /> Request again
                    </Button>
                  )}
                </>
              )}

              {status === null && open && (
                <>
                  <Button size="lg" className="h-12 w-full text-base font-semibold shadow-glow" onClick={() => setRegOpen(true)} disabled={register.isPending}>
                    {register.isPending ? <Loader2 className="animate-spin" /> : null}
                    Register my team
                  </Button>
                  {full ? (
                    <p className="text-center text-xs font-medium text-warning-foreground dark:text-warning">All slots filled · you'll join the waiting list</p>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">Organiser approves · you get a slot</p>
                  )}
                </>
              )}

              {status === null && !open && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-semibold text-muted-foreground">
                  <Lock className="size-4" /> Registration closed
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <RegisterDialog open={regOpen} onOpenChange={setRegOpen} summary={summary} full={full} again={status === "REJECTED"} onConfirm={doRegister} />
      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        summary={summary}
        approved={status === "APPROVED"}
        slot={my?.slotNumber}
        onConfirm={doCancel}
      />
    </article>
  );
}

export function ScrimCardSkeleton() {
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-[8.5rem_1fr_14rem] md:items-center md:gap-6">
      <div className="space-y-2">
        <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-20 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-2 w-full max-w-md animate-pulse rounded-full bg-muted" />
      </div>
      <div className="h-12 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

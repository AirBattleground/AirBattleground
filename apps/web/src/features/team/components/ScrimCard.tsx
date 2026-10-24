import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, Loader2, Lock, Timer } from "lucide-react";
import { addMinutesToTime, MAP_LABELS, matchOffsets, type TeamScrimOnDate } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@7xen/ui/components/ui/popover";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { AskLeaderButton } from "@/features/player/components/AskLeader";
import { NeedTeamDialog } from "@/features/player/components/NeedTeamDialog";
import { ScrimPosterArt } from "@/features/posters/ScrimPosterArt";
import { useCancelRegistration, useRegister } from "../api";
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";
import { formatTime } from "../format";
import { useNow } from "../useNow";
import { useCardTilt } from "../useCardTilt";
import { OrganizerBadge, PosterDialog } from "./Branding";
import { CancelDialog, RegisterDialog, type ScrimSummary } from "./ConfirmDialogs";
import { Countdown } from "./Countdown";
import { MatchBars } from "./MapChips";
import { TeamStatusBadge } from "./TeamStatus";

/**
 * Big poster bleeding off the card's top-left corner, feathered on its inner edges so it melts into the card. Click to
 * enlarge. No poster (`preset`): the organiser's preset fills the same corner unfeathered, so its title stays readable
 * — the card moves its text clear of it (PRESET_TEXT).
 */
function PosterBleed({ scrim, preset, onFailed }: { scrim: TeamScrimOnDate["scrim"]; preset: boolean; onFailed: () => void }) {
  const { posterUrl: url, title } = scrim;
  const t = useT(scrimUi);
  const [open, setOpen] = useState(false);
  const box = "sc-bleed absolute top-0 left-0 size-[9.5rem] sm:size-44";
  if (!url || preset) {
    return (
      <div className="pointer-events-none absolute top-0 left-0 size-[9.5rem] overflow-hidden rounded-br-2xl border-r border-b sm:size-44">
        <ScrimPosterArt
          variant="square"
          data={{ title, maps: scrim.maps, startTime: scrim.startTime, recurrence: scrim.recurrence, organiser: scrim.manager.displayName, template: scrim.posterTemplate }}
        />
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(box, "group/poster z-0 cursor-zoom-in overflow-hidden outline-none")} aria-label={t("view_poster", { title })}>
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onFailed}
          className="size-full object-cover"
        />
      </button>
      <PosterDialog url={url} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** "6:00 PM" with the AM/PM set small */
function Clock({ hhmm }: { hhmm: string }) {
  const [time, ampm] = formatTime(hhmm).split(" ");
  return (
    <>
      {time}
      <span className="ml-0.5 text-[0.55em] font-bold">{ampm}</span>
    </>
  );
}

/** Match 1's start, big; the ⓘ lists every match's start + IDP time. */
function ScrimTimes({ scrim }: { scrim: TeamScrimOnDate["scrim"] }) {
  const t = useT(scrimUi);
  const plan = scrim.matches;
  const timed = plan.every((m) => m.startTime) ? plan.map((m) => m.startTime!) : [];
  const offsets = timed.length ? matchOffsets(timed) : [];
  const [h = 0, m = 0] = scrim.startTime.split(":").map(Number);
  const nextDay = (i: number) => offsets[i] != null && h * 60 + m + offsets[i]! >= 1440;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className="min-w-0 font-display text-2xl leading-none font-extrabold whitespace-nowrap tabular-nums sm:text-3xl">
        <Clock hhmm={scrim.startTime} />{" "}
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground sm:text-xs">IST</span>
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-8 shrink-0 text-muted-foreground hover:text-primary" aria-label={t("times_info")}>
            <Info className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3 p-3.5">
          <p className="font-display text-base font-bold">{t("times_title")}</p>
          <ol className="space-y-2">
            {plan.map((p, i) => (
              <li key={p.number} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold">{t("times_match", { n: p.number })} · {MAP_LABELS[p.map]}</span>
                  {p.startTime && (
                    <span className="block text-xs text-muted-foreground">{t("times_idp", { time: formatTime(addMinutesToTime(p.startTime, -p.idpMinutes)) })}</span>
                  )}
                </span>
                <span className="shrink-0 text-right font-display text-base font-bold tabular-nums">
                  {p.startTime ? formatTime(p.startTime) : "—"}
                  {nextDay(i) && <span className="block text-[10px] font-semibold text-warning">{t("times_next_day")}</span>}
                </span>
              </li>
            ))}
          </ol>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Identity text beside a preset poster: starts 0.75rem past the 9.5rem / 11rem tile and is at least as tall as it. */
const PRESET_TEXT = "min-h-[8.75rem] pl-[9.25rem] sm:min-h-[10rem] sm:pl-[10.5rem]";

/** Soft colour from the poster behind the whole card — atmosphere without covering anything. */
function Ambient({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return <div aria-hidden className="tc-aurora pointer-events-none absolute -top-20 -left-16 size-64 rounded-full bg-[var(--tc-accent)]/15 blur-3xl" />;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="pointer-events-none absolute inset-0 size-full scale-150 object-cover opacity-[0.14] blur-3xl saturate-150 dark:opacity-25"
    />
  );
}

/** "4 left · 12/16" with a slim bar — slots left is the number that matters. */
function SlotMeter({ approved, total, className }: { approved: number; total: number; className?: string }) {
  const t = useT(scrimUi);
  const filled = Math.min(approved, total);
  const left = Math.max(0, total - filled);
  const full = left === 0;
  const almost = !full && left <= Math.max(2, Math.ceil(total * 0.2));
  const tone = full ? "bg-destructive" : almost ? "bg-warning" : "bg-success";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 text-xs", className)} title={`${filled}/${total}`}>
      <span className={cn("text-sm font-bold whitespace-nowrap tabular-nums", full ? "text-destructive" : almost ? "text-warning-foreground dark:text-warning" : "text-success")}>
        {full ? t("full") : t("left", { count: left })}
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full transition-[width] duration-700", tone)} style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
      </span>
      <span className="font-medium text-muted-foreground tabular-nums">{filled}/{total}</span>
    </span>
  );
}

/** `linkTitle`: the title opens the scrim page (off on that page itself). */
export function ScrimCard({ item, rejectionReason, tourAnchor = false, linkTitle = true }: { item: TeamScrimOnDate; rejectionReason?: string | null; tourAnchor?: boolean; linkTitle?: boolean }) {
  const { scrim, date, startsAt, counts, myRegistration: my } = item;
  const t = useT(scrimUi);
  const now = useNow(15_000);
  const closesAt = item.registrationClosesAt ?? startsAt;
  const started = now >= new Date(startsAt).getTime();
  const [posterFailed, setPosterFailed] = useState(false);
  const preset = !scrim.posterUrl || posterFailed;
  const closed = now >= new Date(closesAt).getTime();
  const open = item.registrationOpen && !closed;
  const full = counts.slotsLeft <= 0;
  const status = my?.status === "CANCELLED" ? null : (my?.status ?? null);

  const { isLeader, hasTeam } = usePlayerSession();
  const register = useRegister();
  const cancel = useCancelRegistration();
  const ask = <AskLeaderButton input={{ kind: "SCRIM", scrimId: scrim.id, date }} asked={!!item.mySuggestion} askedBy={item.mySuggestion?.fromIgn} />;
  const [regOpen, setRegOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [needTeamOpen, setNeedTeamOpen] = useState(false);

  const summary: ScrimSummary = { title: scrim.title, date, startTime: scrim.startTime, organiser: scrim.manager.displayName, maps: scrim.maps };
  const tilt = useCardTilt<HTMLElement>(0.3);
  const tour = (name: string) => (tourAnchor ? { "data-tour": name } : {});

  const doRegister = () => register.mutate({ scrimId: scrim.id, date });
  const doCancel = () => my && cancel.mutate({ id: my.id, wasApproved: my.status === "APPROVED", title: scrim.title });
  const tone = status === "APPROVED" ? "success" : status === "PENDING" ? "warning" : open ? "primary" : "muted";

  const closes = (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", open ? "text-muted-foreground" : "text-destructive")}>
      {open ? <Timer className="size-3.5 text-primary" /> : <Lock className="size-3.5" />}
      {open ? (
        <span>
          {t("closes_in")} <Countdown to={closesAt} className="font-semibold text-foreground" />
        </span>
      ) : started ? (
        t("started")
      ) : (
        t("closed")
      )}
    </span>
  );

  return (
    <article
      {...tour("scrim-card")}
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      data-tone={tone}
      className={cn(
        "tc-card group relative h-full overflow-hidden rounded-2xl border bg-card shadow-sm hover:border-transparent hover:shadow-glow",
        status === "APPROVED" && "border-success/40",
        status === "PENDING" && "border-warning/40",
      )}
    >
      <Ambient url={scrim.posterUrl} />
      <div aria-hidden className="sc-tex">
        <div className="sc-tex-dots" />
      </div>
      <div className="tc-sheen pointer-events-none absolute inset-0 z-20" aria-hidden />
      <span aria-hidden className={cn("absolute inset-y-0 left-0 z-20 w-1", tone === "muted" ? "bg-muted-foreground/30" : "sc-rail bg-[var(--tc-accent)]")} />

      <PosterBleed scrim={scrim} preset={preset} onFailed={() => setPosterFailed(true)} />

      <div className="pointer-events-none relative z-10 flex h-full flex-col gap-3 p-3.5 pl-4 sm:p-4 sm:pl-5 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        {/* identity, to the right of the poster */}
        <div className={cn("flex flex-col justify-center gap-1.5", preset ? PRESET_TEXT : "min-h-[8.25rem] pl-[7.75rem] sm:min-h-[9.5rem] sm:pl-[9.25rem]")}>
          <h3 className="line-clamp-2 font-display text-lg leading-tight font-extrabold tracking-tight uppercase transition-colors duration-300 group-hover:text-primary sm:text-xl">
            {linkTitle ? (
              <Link to={`/team/scrims/${scrim.id}?date=${date}`} className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {scrim.title}
              </Link>
            ) : (
              scrim.title
            )}
          </h3>
          <OrganizerBadge
            manager={scrim.manager}
            className="text-xs font-medium text-muted-foreground"
            iconClassName="size-3.5 text-primary"
            logoClassName="size-5 rounded-md"
          />
          <ScrimTimes scrim={scrim} />
          {closes}
        </div>

        {/* one quiet meta line */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <MatchBars maps={scrim.maps} label={t.plural("matches", scrim.maps.length)} />
          <SlotMeter approved={counts.approved} total={scrim.slotCount} />
        </div>

        {/* action */}
        <div className="mt-auto flex flex-col gap-2" {...tour("scrim-action")}>
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
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xl font-bold text-success">{t("youre_in")}</p>
                    {started && <p className="text-xs text-muted-foreground">{t("in_progress")}</p>}
                  </div>
                  {!closed && isLeader && (
                    <Button variant="ghost" className="h-10 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setCancelOpen(true)}>
                      {t("cancel")}
                    </Button>
                  )}
                </div>
              )}

              {status === "PENDING" && (
                <div className="flex items-center justify-between gap-2">
                  <div {...tour("scrim-status")}>
                    <TeamStatusBadge status="PENDING" className="px-3 py-1 text-sm" />
                  </div>
                  {!closed && isLeader && (
                    <Button variant="ghost" className="h-10 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setCancelOpen(true)}>
                      {t("cancel_request")}
                    </Button>
                  )}
                </div>
              )}

              {status === "REJECTED" && (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <TeamStatusBadge status="REJECTED" className="px-3 py-1 text-sm" />
                    {rejectionReason && <p className="min-w-0 text-xs text-muted-foreground">{t("reason", { reason: rejectionReason })}</p>}
                  </div>
                </>
              )}

              {status === null && open && (
                <>
                  {!hasTeam ? (
                    // phase 5c: no team yet → "You need a team to register" (create → straight back to this registration)
                    <Button size="lg" className="h-11 w-full text-base font-semibold shadow-glow" onClick={() => setNeedTeamOpen(true)}>
                      {t("register_scrim")}
                    </Button>
                  ) : isLeader ? (
                    <Button size="lg" className="h-11 w-full text-base font-semibold shadow-glow" onClick={() => setRegOpen(true)} disabled={register.isPending || full}>
                      {register.isPending ? <Loader2 className="animate-spin" /> : null}
                      {t("register_team")}
                    </Button>
                  ) : (
                    ask
                  )}
                  {full && <p className="text-center text-xs font-medium text-warning-foreground dark:text-warning">{t("full_waitlist")}</p>}
                </>
              )}

              {status === null && !open && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-muted-foreground">
                  <Lock className="size-4" /> {t("reg_closed")}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <NeedTeamDialog open={needTeamOpen} onOpenChange={setNeedTeamOpen} what={t("this_scrim")} onTeamCreated={() => setRegOpen(true)} />
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
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-3.5 pl-4 sm:p-4 sm:pl-5">
      <div className="sc-bleed absolute top-0 left-0 size-[9.5rem] animate-pulse bg-muted sm:size-44" />
      <div className="relative flex min-h-[8.25rem] flex-col justify-center gap-2 pl-[7.75rem] sm:min-h-[9.5rem] sm:pl-[9.25rem]">
        <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-6 w-3/4 animate-pulse rounded-md bg-muted" />
        <div className="h-7 w-28 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-11 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

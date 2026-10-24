import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Gamepad2, Map as MapIcon, Timer, Trophy, Users } from "lucide-react";
import { MAP_LABELS, type TeamRegistration, type TeamScrimOnDate } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { Countdown } from "@/features/tournaments/shared/Countdown";
import { ScrimPosterArt, type PosterData } from "@/features/posters/ScrimPosterArt";
import { useRegister } from "../api";
import { RegisterDialog } from "../components/ConfirmDialogs";
import { useDayFormat } from "../format";
import { useT } from "@/i18n/core";
import { homeMsg } from "@/i18n/home";
import { heroBackground } from "./StageArt";

/**
 * Full-bleed key art behind the featured hero: it runs edge to edge and up under the see-through header
 * (--shell-top, set by the shell), and is darkened toward
 * the copy (left), the card (right) and the page (bottom), so the hero melts into the page with no box.
 * Every wash uses --background, so light and dark both blend.
 */
function HeroBackdrop() {
  const [failed, setFailed] = useState(false);
  const url = heroBackground();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[calc(-1*var(--shell-top,0px))] bottom-0 -z-10 overflow-hidden">
      {url && !failed && (
        <img
          src={url}
          alt=""
          fetchPriority="high"
          decoding="async"
          onError={() => setFailed(true)}
          className="home-hero-bg size-full object-cover object-[64%_30%] dark:brightness-[0.92]"
        />
      )}
      {/* copy side: solid page colour fading out across the middle */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_oklch,var(--background)_88%,transparent)_28%,color-mix(in_oklch,var(--background)_45%,transparent)_52%,transparent_72%)] max-lg:bg-[linear-gradient(90deg,color-mix(in_oklch,var(--background)_92%,transparent)_0%,color-mix(in_oklch,var(--background)_70%,transparent)_100%)]" />
      {/* card side + top (under the topbar) */}
      <div className="absolute inset-0 bg-[linear-gradient(270deg,color-mix(in_oklch,var(--background)_55%,transparent)_0%,transparent_28%)] max-lg:hidden" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/60 to-transparent" />
      {/* bottom: melt into the page */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-background via-background/70 to-transparent" />
      {/* a breath of brand light so the art sits in the theme */}
      <div className="absolute inset-0 bg-primary opacity-[0.07] mix-blend-color" />
    </div>
  );
}

export interface HeroStatItem {
  icon: ReactNode;
  value: ReactNode;
  label: string;
}

function HeroStats({ items }: { items: HeroStatItem[] }) {
  return (
    <dl className="mt-8 grid grid-cols-3 gap-3 sm:mt-9 sm:flex sm:flex-wrap sm:items-center sm:gap-x-0 sm:gap-y-4" data-tour="stats">
      {items.map((s, i) => (
        <div key={s.label} className={cn("flex min-w-0 items-center gap-3 sm:px-6", i === 0 && "sm:pl-0", i > 0 && "sm:border-l sm:border-foreground/15", i > 2 && "max-sm:hidden")}>
          <span className="hidden size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20 sm:flex [&_svg]:size-5">{s.icon}</span>
          <div className="flex min-w-0 flex-col">
            <dt className="order-2 text-xs leading-tight text-muted-foreground sm:text-sm">{s.label}</dt>
            <dd className="text-xl leading-tight font-bold tabular-nums sm:text-2xl">{s.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </li>
  );
}

/** `art`: the scrim's preset, drawn behind the title when there's no poster image */
function Poster({ url, title, art, left, right }: { url: string | null; title: string; art: PosterData; left: ReactNode; right: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const has = !!url && !failed;
  return (
    <div className="relative overflow-hidden rounded-xl border bg-muted">
      <div className="relative z-10 flex items-center justify-between gap-2 bg-background/70 px-2.5 py-2 backdrop-blur-md">
        {left}
        {right}
      </div>
      <div className="relative h-32">
        {has ? (
          <img src={url!} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
        ) : (
          <ScrimPosterArt variant="strip" data={art} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/20 to-transparent" />
        <p className="font-hero absolute inset-x-3 bottom-2 line-clamp-2 text-center text-2xl leading-[0.95] font-extrabold tracking-wide uppercase drop-shadow-[0_2px_10px_var(--background)]">
          {title}
        </p>
      </div>
    </div>
  );
}

const pill = "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold";
const maps = (m: TeamRegistration["scrim"]["maps"], tba: string) => (m.length ? m.map((x) => MAP_LABELS[x]).join(" • ") : tba);

/**
 * "Next Match": the team's next approved match (slot + countdown) or, when nothing is booked,
 * the next scrim still taking teams with a one-tap "Register now".
 */
export function NextMatchCard({ booked, open, today, loading }: { booked: TeamRegistration | null; open: TeamScrimOnDate | null; today: string; loading: boolean }) {
  const t = useT(homeMsg);
  const { whenLabel } = useDayFormat();
  const { isLeader, hasTeam } = usePlayerSession();
  const register = useRegister();
  const [regOpen, setRegOpen] = useState(false);
  const shell = "w-full rounded-2xl border bg-card/80 p-4 shadow-2xl shadow-background/60 backdrop-blur-xl sm:p-5";

  const header = (to: string) => (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xl font-bold">{t("next_match")}</h2>
      <Link to={to} className="rounded text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {t("view_all")}
      </Link>
    </div>
  );

  if (loading) {
    return (
      <div className={shell} data-tour="next-match">
        <div className="mb-3 h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-[10.5rem] animate-pulse rounded-xl bg-muted" />
        <div className="mt-3 space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-4 h-12 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (booked) {
    const s = booked.scrim;
    // count down to the match being played / up next tonight, not just match 1
    const game = booked.nextGame;
    const gameAt = game?.startsAt ?? booked.startsAt;
    return (
      <div className={shell} data-tour="next-match">
        {header("/team/registrations")}
        <Poster
          url={s.posterUrl}
          title={s.title}
          art={{ title: s.title, maps: s.maps, startTime: s.startTime, organiser: s.manager.displayName, template: s.posterTemplate }}
          left={<span className={cn(pill, "bg-primary/15 text-primary uppercase")}>{t("scrim")}</span>}
          right={
            <span className={cn(pill, "bg-success/15 text-success")}>
              <span className="size-1.5 rounded-full bg-success" /> {t("youre_in")}
            </span>
          }
        />
        <ul className="mt-2 divide-y">
          <Row icon={<CalendarDays />}>{whenLabel(booked.date, s.startTime, today)}</Row>
          <Row icon={<MapIcon />}>{maps(s.maps, t("maps_tba"))}</Row>
          <Row icon={<Timer />}>
            {game && s.maps.length > 1 && <span className="font-semibold">{t("match_n", { n: game.number, map: MAP_LABELS[game.map] })} · </span>}
            {t("starts_in")} <Countdown to={gameAt} className="font-semibold" doneText={t("now")} />
          </Row>
        </ul>
        <div className="mt-3 flex items-center gap-3" data-tour="next-slot">
          {booked.slotNumber != null && (
            <div className="flex flex-col items-center">
              <SlotChip slot={booked.slotNumber} size="md" />
              <span className="mt-0.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{t("slot")}</span>
            </div>
          )}
          <Button asChild size="lg" className="h-12 flex-1 text-base font-semibold shadow-glow">
            <Link to="/team/registrations">
              {t("my_slots")} <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (open) {
    const s = open.scrim;
    const canRegister = hasTeam && isLeader;
    return (
      <div className={shell} data-tour="next-match">
        {header("/team/scrims")}
        <Poster
          url={s.posterUrl}
          title={s.title}
          art={{ title: s.title, maps: s.maps, startTime: s.startTime, organiser: s.manager.displayName, template: s.posterTemplate }}
          left={<span className={cn(pill, "bg-primary/15 text-primary uppercase")}>{t("scrim")}</span>}
          right={
            <span className={cn(pill, "bg-success/15 text-success")}>
              <span className="size-1.5 rounded-full bg-success" /> {t("reg_open")}
            </span>
          }
        />
        <ul className="mt-2 divide-y">
          <Row icon={<CalendarDays />}>{whenLabel(open.date, s.startTime, today)}</Row>
          <Row icon={<MapIcon />}>{maps(s.maps, t("maps_tba"))}</Row>
          <Row icon={<Users />}>
            <span className="font-semibold">
              {open.counts.approved} / {s.slotCount}
            </span>{" "}
            {t("teams_registered")}
          </Row>
        </ul>
        {canRegister ? (
          <Button size="lg" className="mt-3 h-12 w-full text-base font-semibold shadow-glow" onClick={() => setRegOpen(true)} disabled={register.isPending}>
            {t("register_now")} <ArrowRight />
          </Button>
        ) : (
          <Button asChild size="lg" className="mt-3 h-12 w-full text-base font-semibold shadow-glow">
            <Link to={open.date === today ? "/team/scrims" : `/team/scrims?date=${open.date}`}>
              {t("view_scrim")} <ArrowRight />
            </Link>
          </Button>
        )}
        <RegisterDialog
          open={regOpen}
          onOpenChange={setRegOpen}
          summary={{ title: s.title, date: open.date, startTime: s.startTime, organiser: s.manager.displayName, maps: s.maps }}
          full={open.counts.slotsLeft <= 0}
          onConfirm={() => register.mutate({ scrimId: s.id, date: open.date })}
        />
      </div>
    );
  }

  return (
    <div className={shell} data-tour="next-match">
      {header("/team/scrims")}
      <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20">
          <Gamepad2 className="size-6" />
        </span>
        <p className="mt-3 font-semibold">{t("no_match_title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("no_match_text")}</p>
      </div>
      <Button asChild size="lg" className="mt-3 h-12 w-full text-base font-semibold shadow-glow">
        <Link to="/team/scrims">
          {t("find_scrim")} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

/**
 * The featured hero (top of /team): full-bleed battle art, two-tone condensed headline, the two main actions,
 * key numbers, and the Next Match card on the right. Breaks out of the layout padding so the art reaches the
 * sidebar, topbar and right edge (offsets mirror the shell's px-4/5/6 + pt-4/5).
 */
export function FeaturedHero({ eyebrow, stats, card, error }: { eyebrow: ReactNode; stats: HeroStatItem[]; card: ReactNode; error?: ReactNode }) {
  const t = useT(homeMsg);
  return (
    <section className="relative isolate -mx-4 -mt-4 px-4 sm:-mx-5 sm:-mt-5 sm:px-5 lg:-mx-6 lg:px-6" data-tour="home-hero">
      <HeroBackdrop />
      <div className="grid gap-8 pt-8 pb-10 sm:pt-12 lg:min-h-[28rem] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)] lg:items-center lg:gap-10 lg:pt-10 lg:pb-12 xl:pl-6">
        <div className="min-w-0 animate-rise">
          <p className="text-xs font-semibold tracking-[0.3em] text-muted-foreground uppercase sm:text-sm">{eyebrow}</p>
          <h1 className="font-hero mt-3 text-[2.6rem] leading-[0.92] font-extrabold tracking-tight uppercase drop-shadow-[0_2px_24px_var(--background)] sm:text-6xl xl:text-[4.25rem] 2xl:text-[4.75rem]">
            <span className="block">{t("hero_line1")}</span>
            <span className="block text-primary">{t("hero_line2")}</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-foreground/85 sm:text-[17px]">
            {t("hero_text")}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-base font-semibold shadow-[0_0_28px_-6px_var(--primary)]" data-tour="find-scrim">
              <Link to="/team/scrims">
                <Gamepad2 /> {t("find_scrim")} <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 border-foreground/40 bg-transparent px-6 text-base font-semibold hover:bg-foreground/5 dark:bg-transparent">
              <Link to="/team/tournaments">
                <Trophy /> {t("view_cups")}
              </Link>
            </Button>
          </div>
          {stats.length > 0 && <HeroStats items={stats} />}
        </div>
        <div className="min-w-0 animate-rise [animation-delay:120ms]">{error ?? card}</div>
      </div>
      {/* hairline where the art ends — the page continues on the same colours */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </section>
  );
}

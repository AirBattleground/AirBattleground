import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Play, Plus } from "lucide-react";
import { addDays, todayInAppTz, type TeamRegistration } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { usePlayerTeam } from "@/features/player/api";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { TeamLogo } from "@/features/player/components/TeamLogo";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { RoomValue } from "@/features/live/components/RoomValue";
import { useRooms } from "@/features/live/components/TeamRoom";
import { fmtClock } from "@/features/live/format";
import { useNow } from "@/features/team/useNow";
import { BgCoin } from "@/features/coins/components/BgCoin";
import { useCoinLeaderboard } from "@/features/coins/components/CoinLeaderboard";
import { useTeamScrimsForDays } from "@/features/team/api";
import { useFeaturedTournaments } from "@/features/team/home/TournamentRail";
import { useTeamTournaments } from "@/features/tournaments/team/api";
import { Countdown } from "@/features/tournaments/shared/Countdown";
import { fmtPrize } from "@/features/tournaments/shared/format";
import squadUrl from "./squad.webp";
import mapUrl from "./erangel.webp";
import { useDateFormat, useT } from "@/i18n/core";
import { arenaMsg } from "@/i18n/home";
import { liveMsg } from "@/i18n/live";

const WEEK = 7;
/** "Sat, 8:00 PM" in the current language */
function useWhen() {
  const fmt = useDateFormat();
  return (iso: string) => fmt(iso, "EEE, h:mm a");
}

/** Panel = see-through HUD glass with corner brackets and a chamfered corner. */
function Panel({ className, children, hud = true }: { className?: string; children: React.ReactNode; hud?: boolean }) {
  return <div className={cn("arena-panel arena-chamfer p-4", hud && "arena-hud", className)}>{children}</div>;
}

function SquadPanel() {
  const tr = useT(arenaMsg);
  const { team, isLeader } = usePlayerSession();
  const q = usePlayerTeam({ enabled: !!team, poll: false });
  const t = q.data;
  if (!team) {
    return (
      <Panel>
        <p className="arena-label">{tr("my_squad")}</p>
        <p className="mt-1 font-display text-2xl font-semibold uppercase">{tr("no_squad")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{tr("no_squad_text")}</p>
        <Link to="/team/my-team" className="mt-3 flex h-10 items-center justify-center gap-1.5 border border-primary/50 bg-primary/10 text-sm font-semibold uppercase tracking-wider hover:bg-primary/20">
          <Plus className="size-4" /> {tr("create_join")}
        </Link>
      </Panel>
    );
  }
  const members = t?.members ?? [];
  const max = Math.max(t?.maxMembers ?? 4, 4);
  const free = Math.max(0, Math.min(4, max) - members.length);
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className="arena-label">{tr("my_squad")}</span>
        <span className="text-xs text-muted-foreground">{t ? tr("players", { n: members.length, max }) : "…"}</span>
      </div>
      <Link to="/team/my-team" className="mt-1.5 flex items-center gap-2.5 hover:text-primary">
        <TeamLogo name={team.name} tag={team.tag} logoUrl={t?.logoUrl ?? null} size="sm" />
        <span className="min-w-0 truncate font-display text-2xl leading-none font-semibold">
          {team.name} <span className="text-base text-primary">[{team.tag}]</span>
        </span>
      </Link>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {members.slice(0, 4).map((m) => (
          <div key={m.id} className="relative flex aspect-square flex-col items-center justify-center gap-1 border border-border bg-background/40 p-1" title={m.ign ?? m.displayName}>
            <PlayerAvatar name={m.ign ?? m.displayName} url={m.avatarUrl} size="sm" />
            <span className="w-full truncate text-center text-[10px] font-semibold">{m.ign ?? m.displayName}</span>
            {m.role === "LEADER" && <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 bg-warning px-1 text-[8px] font-extrabold tracking-wider text-warning-foreground">{tr("lead")}</span>}
          </div>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <Link key={i} to="/team/my-team" aria-label={tr("invite_player")} className="flex aspect-square items-center justify-center border border-dashed border-primary/50 text-primary hover:bg-primary/10">
            <Plus className="size-6" />
          </Link>
        ))}
      </div>
      {free > 0 && isLeader && <p className="mt-2.5 text-xs text-muted-foreground">{tr.plural("invite_more", free)} → <Link to="/team/my-team" className="text-primary hover:underline">{tr("share_invite")}</Link></p>}
    </Panel>
  );
}

function CoinPanel() {
  const tr = useT(arenaMsg);
  const lb = useCoinLeaderboard().data;
  const mine = lb?.myTeam;
  return (
    <Link to="/team/coins" className="arena-panel arena-chamfer flex items-center gap-3 p-4 transition-colors hover:border-warning/60">
      <BgCoin className="size-11" shine />
      <div className="min-w-0 flex-1">
        <p className="arena-label" style={{ color: "var(--arena-gold)" }}>
          {tr("bg_coins")}
        </p>
        <p className="font-display text-3xl leading-none font-semibold tabular-nums">
          {(mine?.coins ?? 0).toLocaleString("en-IN")} {mine && <span className="text-lg text-muted-foreground">· {tr("rank", { rank: mine.rank })}</span>}
        </p>
      </div>
      <span className="text-right text-xs text-muted-foreground">{mine ? tr.plural("wins", mine.wins) : tr("win_to_earn")}</span>
    </Link>
  );
}

function EventCard() {
  const tr = useT(arenaMsg);
  const featured = useFeaturedTournaments();
  const [posterFailed, setPosterFailed] = useState(false);
  const t = featured.items.find((x) => x.mode !== "TDM") ?? featured.items[0];
  if (!t) return null;
  const open = t.status === "REGISTRATION_OPEN";
  const poster = !!t.posterUrl && !posterFailed;
  const copy = (
    <>
      <p className="arena-label" style={{ color: "var(--arena-gold)" }}>
        {t.mode === "TDM" ? tr("tdm_battle") : tr("featured_cup")} · {open ? tr("reg_open") : t.status === "LIVE" ? tr("live") : tr("coming_up")}
      </p>
      <p className={cn("mt-1 font-display leading-[0.9] font-semibold uppercase", poster ? "truncate text-2xl" : "line-clamp-2 text-3xl")}>{t.title}</p>
      {t.prize && <p className="mt-1.5 font-display text-2xl leading-none font-semibold text-warning drop-shadow-[0_0_14px_var(--arena-gold)]">{tr("prize", { prize: fmtPrize(t.prize) })}</p>}
      {open && t.registrationClosesAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr("closes_in")} <Countdown to={t.registrationClosesAt} className="font-display text-base font-semibold text-foreground" doneText={tr("moments")} />
        </p>
      )}
    </>
  );
  // posters carry their own title/prize art: show the whole poster (25:9) and put the copy underneath, never on top
  if (poster)
    return (
      <Link to={`/team/tournaments/${t.id}`} className="arena-hud arena-chamfer group relative block overflow-hidden border border-warning/30 bg-card">
        <div className="relative aspect-[25/9] w-full overflow-hidden [mask-image:linear-gradient(to_bottom,#000_80%,transparent)]">
          <img src={t.posterUrl!} alt="" onError={() => setPosterFailed(true)} className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
        </div>
        <div className="relative px-4 pt-2 pb-4">{copy}</div>
      </Link>
    );
  return (
    <Link to={`/team/tournaments/${t.id}`} className="arena-hud arena-chamfer group relative block h-44 overflow-hidden border border-warning/30 bg-gradient-to-br from-destructive/40 to-background">
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
      <div className="relative p-4">{copy}</div>
    </Link>
  );
}

function LivePanel() {
  const tr = useT(arenaMsg);
  const live = useLiveBroadcasts().data ?? [];
  return (
    <Panel hud={false} className="p-0">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="arena-label" style={{ color: "var(--destructive)" }}>
          {tr("live_now")}
        </span>
        <Link to="/team/live" className="text-xs text-muted-foreground hover:text-primary">
          {live.length ? tr.plural("live_matches", live.length) : tr("all_streams")}
        </Link>
      </div>
      {live.length === 0 ? (
        <p className="px-4 pt-1.5 pb-4 text-sm text-muted-foreground">{tr("nothing_live")}</p>
      ) : (
        <ul className="space-y-1 p-2">
          {live.slice(0, 3).map((b) => (
            <li key={b.matchId}>
              <Link to={`/team/live/${b.matchId}`} className="flex items-center gap-3 p-2 hover:bg-accent/40">
                <span className="relative flex h-12 w-20 shrink-0 items-center justify-center border border-destructive/50 bg-destructive/15">
                  <span className="absolute top-1 left-1 bg-destructive px-1 text-[9px] font-extrabold tracking-wider text-white">{tr("live_badge")}</span>
                  <Play className="size-4 fill-current" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg leading-none font-semibold uppercase">
                    {b.title} · M{b.number}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{b.organizer.name}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The strip keeps showing a match this long after it starts (room still needed if it runs late), then moves on. */
const HOLD_MS = 5 * 60_000;

/**
 * The next match strip + Find match. The strip shows the team's next match (from the rooms feed, so scrims and cups,
 * each match in turn) with its room ID / password to copy, or when the room appears; 5 minutes after a match starts
 * it moves on to the next one. No room entry → the booked registration; nothing booked → scrims open this week.
 */
function FindMatch({ next, openThisWeek }: { next: TeamRegistration | null; openThisWeek: number | null }) {
  const tr = useT(arenaMsg);
  const tl = useT(liveMsg);
  const when = useWhen();
  const now = useNow(30_000);
  const rooms = useRooms().data;
  const card =
    (rooms ?? [])
      .filter((c) => c.startsAt && new Date(c.startsAt).getTime() + HOLD_MS > now)
      .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))[0] ?? null;
  const match = card ? { title: card.title, startsAt: card.startsAt!, slot: card.slotNumber } : next ? { title: next.scrim.title, startsAt: next.nextGame?.startsAt ?? next.startsAt, slot: next.slotNumber } : null;
  return (
    <div data-tour="find-scrim">
      <div className="arena-panel border-b-0 px-4 py-2.5 text-sm text-muted-foreground [clip-path:polygon(14px_0,100%_0,100%_100%,0_100%,0_14px)]">
        {match ? (
          <>
            <p>
              {tr("next")} · <b className="text-foreground">{match.title}</b> · {when(match.startsAt)}
              {match.slot != null && <b className="ml-1 whitespace-nowrap text-warning">· {tr("slot", { slot: String(match.slot).padStart(2, "0") })}</b>}
            </p>
            {card &&
              (card.room ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <RoomValue label={tr("room_id_short")} value={card.room.roomId} copyLabel={tl("copy_room_id")} />
                  <RoomValue label={tr("room_pass_short")} value={card.room.password} copyLabel={tl("copy_password")} />
                </div>
              ) : (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                  <Lock className="size-3.5 text-primary" />
                  {card.revealAt ? tr("room_at", { time: fmtClock(card.revealAt) }) : tr("room_not_out")}
                </p>
              ))}
          </>
        ) : (
          <>{openThisWeek == null ? tr("finding") : tr.plural("open_week", openThisWeek)}</>
        )}
      </div>
      <Link to="/team/scrims" className="arena-btn-gold flex h-[5.5rem] items-center justify-between px-6 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span>
          <span className="block font-display text-xs font-semibold tracking-[0.25em]">{tr("one_tap")}</span>
          <span className="block font-display text-5xl leading-[0.85] font-bold tracking-wide">{tr("find_match")}</span>
        </span>
        <Play className="size-9 fill-current" />
      </Link>
    </div>
  );
}

function Ticker({ items }: { items: string[] }) {
  const tr = useT(arenaMsg);
  if (!items.length) return null;
  const row = items.map((t, i) => (
    <span key={i} className="flex items-center gap-6">
      <span>{t}</span>
      <span className="text-primary">◆</span>
    </span>
  ));
  return (
    <div className="flex h-11 items-center overflow-hidden border-y border-border bg-background/80 font-display text-base tracking-wide text-muted-foreground">
      <span className="z-10 flex h-full shrink-0 items-center bg-destructive px-3 text-sm font-bold tracking-[0.2em] text-white">{tr("live_badge")}</span>
      <div className="arena-ticker-track flex shrink-0 gap-6 pl-6 whitespace-nowrap">
        {row}
        {row}
      </div>
    </div>
  );
}

/**
 * Arena home hero: the game lobby. Your squad stands on the stage; around it the squad, modes, coins, featured event,
 * live matches and one big Find match. All real data; the regular home sections continue below.
 */
export default function ArenaLobby({ next }: { next: TeamRegistration | null }) {
  const tr = useT(arenaMsg);
  const when = useWhen();
  const { user, player } = usePlayerSession();
  const today = todayInAppTz();
  const week = useMemo(() => Array.from({ length: WEEK }, (_, i) => addDays(today, i)), [today]);
  const days = useTeamScrimsForDays(week);
  const now = Date.now();
  const openScrims = days.isLoading ? null : week.flatMap((d) => days.byDate.get(d) ?? []).filter((s) => s.registrationOpen && new Date(s.startsAt).getTime() > now).length;
  const open = useTeamTournaments("open");
  const live = useLiveBroadcasts().data ?? [];
  const name = player?.ign ?? user?.displayName ?? tr("player");

  const ticker = [
    ...live.map((b) => tr("tick_live", { title: b.title, n: b.number, org: b.organizer.name })),
    ...(next ? [tr("tick_next", { title: next.scrim.title, when: when(next.startsAt) })] : []),
    ...(open.data ?? []).slice(0, 3).map((t) => `${tr("tick_open", { title: t.title })}${t.prize ? ` · ${fmtPrize(t.prize)}` : ""}`),
    ...(openScrims ? [tr("tick_scrims", { count: openScrims })] : []),
  ];

  return (
    <section aria-label={tr("lobby")} className="relative -mx-4 -mt-4 overflow-hidden sm:-mx-5 sm:-mt-5 lg:-mx-6 lg:-mt-6">
      {/* stage backdrop */}
      <div aria-hidden className="absolute inset-0">
        <img src={mapUrl} alt="" className="size-full scale-110 object-cover opacity-35 saturate-50 dark:opacity-25" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_70%_at_50%_58%,color-mix(in_oklch,var(--primary)_28%,transparent),transparent_70%)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
        <div className="arena-grid absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_50%_60%,#000,transparent_65%)]" />
      </div>

      <div className="relative grid gap-4 px-4 pt-5 pb-5 sm:px-5 lg:min-h-[calc(100dvh-var(--shell-top)-2.75rem)] lg:grid-cols-[20rem_minmax(0,1fr)_22rem] lg:px-6 xl:grid-cols-[22rem_minmax(0,1fr)_24rem]">
        {/* greeting (phones: on top) */}
        <div className="lg:absolute lg:top-6 lg:left-[23rem] xl:left-[25rem] lg:z-10">
          <p className="arena-label">{tr("lobby_label")}</p>
          <h1 className="font-display text-6xl leading-[0.82] font-bold uppercase sm:text-7xl xl:text-8xl">
            {tr("drop_in")}
            <span className="block text-primary normal-case drop-shadow-[0_0_30px_var(--glow)]">{name}</span>
          </h1>
        </div>

        {/* left column */}
        <div className="order-3 flex flex-col gap-4 lg:order-none lg:pt-2">
          <SquadPanel />
          <CoinPanel />
        </div>

        {/* stage */}
        <div className="relative order-1 flex min-h-[20rem] items-end justify-center lg:order-none lg:min-h-0">
          <div aria-hidden className="arena-ring absolute bottom-3 left-1/2 h-14 w-[80%] max-w-[40rem] -translate-x-1/2" />
          <div aria-hidden className="absolute bottom-0 left-1/2 h-24 w-[90%] max-w-[46rem] -translate-x-1/2 rounded-[50%] bg-primary/30 blur-2xl" />
          <img
            src={squadUrl}
            alt=""
            className="relative max-h-[20rem] w-auto object-contain drop-shadow-[0_30px_60px_rgb(0_0_0/0.6)] sm:max-h-[30rem] lg:max-h-[min(44rem,calc(100dvh-var(--shell-top)-6rem))]"
          />
          <p className="absolute bottom-1 left-1/2 hidden -translate-x-1/2 font-display text-sm tracking-[0.4em] whitespace-nowrap text-primary uppercase sm:block">
            ◆ {user?.team ? (<><span className="normal-case">{user.team.name}</span> · {tr("squad_ready")}</>) : tr("build_squad")} ◆
          </p>
        </div>

        {/* right column */}
        <div className="order-2 flex flex-col gap-4 lg:order-none lg:pt-2">
          <div className="order-2 lg:order-none">
            <EventCard />
          </div>
          <div className="order-3 lg:order-none">
            <LivePanel />
          </div>
          <div className="order-1 mt-auto lg:order-none">
            <FindMatch next={next} openThisWeek={openScrims} />
          </div>
        </div>
      </div>

      <div className="relative">
        <Ticker items={ticker} />
      </div>
    </section>
  );
}

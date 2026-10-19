import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, CircleDashed, Cpu, PlugZap, CheckCircle2, ChevronRight, Hourglass, KeyRound, Shield, Swords, Trophy, UserPlus, UserRound, Users } from "lucide-react";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ActivePill } from "@/components/StatusPill";
import { useManagers } from "@/features/managers/api";
import { usePlayers } from "@/features/players/api";
import { useAdminStats } from "@/features/stats/api";
import { useTeams } from "@/features/teams/api";
import { useAdminTournaments } from "@/features/tournaments/api";
import { useExtractorStatus, useSamples } from "@/features/training/api";
import { ManagerAppCard } from "@/features/managerApp/ManagerAppCard";
import { StationCard } from "@/features/station/StationCard";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { element: '[data-tour="stats"]', title: "Welcome to your control room", description: "These numbers show managers, players and teams on 7xen, scrims running, and registrations waiting for approval.", side: "bottom" },
  { element: '[data-tour="quick-actions"]', title: "Quick actions", description: "Make a manager login in a few clicks, or see the players who signed up with Google.", side: "bottom" },
  { element: '[data-tour="reader-card"]', title: "Screenshot reader", description: "Claude reads match screenshots for managers. Checked samples here are a test set for spotting what it gets wrong.", side: "bottom" },
  { element: '[data-tour="tournaments-card"]', title: "Tournaments", description: "How many tournaments are live or open for registration right now. Click to see them all.", side: "bottom" },
  { element: '[data-tour="manager-app-card"]', title: "Manager app", description: "Match videos recorded by managers' phones, the room-creation recipes, and how long videos are kept.", side: "bottom" },
  { element: '[data-tour="station-card"]', title: "7XEN Station", description: "The game phone that runs on the server PC. It records and streams matches for managers. Shows whether it's online and what it's doing.", side: "bottom" },
  { element: '[data-tour="how-it-works"]', title: "How 7xen works", description: "You create manager logins, players make teams, managers run scrims and team leaders register for slots. That's it!", side: "top" },
  { element: '[data-tour="nav-managers"]', title: "Your menu", description: "Managers, Teams and Players live here. Search, reset a manager's password, see a team's members or turn an account off.", side: "right" },
  { element: '[data-tour="tour-btn"]', title: "Need a refresher?", description: "Click here any time to replay the tour for the page you're on.", side: "bottom" },
];

const fade = (i: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 * i, duration: 0.35 } });

function Stats() {
  const { data, isPending, isError, error } = useAdminStats();
  // AdminStats has no player numbers, so count them from the players list
  const players = usePlayers();
  if (isPending)
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" data-tour="stats">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
    );
  if (isError)
    return (
      <div data-tour="stats" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Couldn't load stats. {errorMessage(error)}
      </div>
    );
  const of = (n: number, total: number) => (
    <>
      {n}
      <span className="ml-1 text-lg font-semibold text-muted-foreground">/ {total}</span>
    </>
  );
  const cards: { label: string; value: ReactNode; hint: string; icon: ReactNode; tone: "brand" | "success" | "warning" | "info" }[] = [
    { label: "Managers", value: of(data.managers.active, data.managers.total), hint: "Active / total", icon: <Users />, tone: "brand" },
    {
      label: "Players",
      value: players.data ? of(players.data.items.filter((p) => p.isActive).length, players.data.items.length) : "—",
      hint: players.data ? "Active / total" : players.isError ? "Couldn't load players" : "Loading…",
      icon: <UserRound />,
      tone: "info",
    },
    { label: "Teams", value: data.teams.total, hint: "Made by players", icon: <Shield />, tone: "info" },
    { label: "Active scrims", value: data.scrims.active, hint: `${data.scrims.total} created in total`, icon: <Swords />, tone: "brand" },
    { label: "Pending", value: data.registrations.pending, hint: "Waiting for manager approval", icon: <Hourglass />, tone: "warning" },
    { label: "Upcoming slots", value: data.registrations.approvedUpcoming, hint: "Approved, not yet played", icon: <CheckCircle2 />, tone: "success" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" data-tour="stats">
      {cards.map((c, i) => (
        <motion.div key={c.label} {...fade(i)}>
          <StatCard className="h-full" {...c} />
        </motion.div>
      ))}
    </div>
  );
}

/** Small "Tournaments" card: live / open counts, links to the section. */
function TournamentsCard() {
  const { data, isPending, isError } = useAdminTournaments({ refetchInterval: 60_000 });
  const items = data?.items ?? [];
  const live = items.filter((t) => t.status === "LIVE").length;
  const open = items.filter((t) => t.status === "REGISTRATION_OPEN").length;
  return (
    <Link
      to={live ? "/tournaments?status=LIVE" : open ? "/tournaments?status=REGISTRATION_OPEN" : "/tournaments"}
      data-tour="tournaments-card"
      className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary [&_svg]:size-6">
        <Trophy />
        {live > 0 && <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full border-2 border-card bg-primary" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl font-bold">Tournaments</div>
        <div className="text-sm text-muted-foreground">
          {isPending ? <Skeleton className="mt-1 h-4 w-40" /> : isError ? "Couldn't load tournaments" : items.length ? `${items.length} in total, from every manager` : "None yet — managers create them"}
        </div>
      </div>
      {!isPending && !isError && (
        <div className="flex shrink-0 gap-4 text-center">
          <div>
            <div className="font-display text-2xl leading-none font-bold text-primary">{live}</div>
            <div className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Live</div>
          </div>
          <div>
            <div className="font-display text-2xl leading-none font-bold">{open}</div>
            <div className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Open</div>
          </div>
        </div>
      )}
      <ArrowRight className="hidden size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary sm:block" />
    </Link>
  );
}

function QuickAction({ to, icon, title, text }: { to: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link
      to={to}
      className="group relative flex items-center gap-4 overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow [&_svg]:size-6">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl font-bold">{title}</div>
        <div className="text-sm text-muted-foreground">{text}</div>
      </div>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
    </Link>
  );
}

const STEPS = [
  { icon: <KeyRound />, title: "You create manager logins", text: "Players sign up themselves with Google and build their own teams." },
  { icon: <CalendarClock />, title: "Managers run scrims", text: "They schedule scrims and approve the teams that sign up." },
  { icon: <Trophy />, title: "Leaders get slots", text: "A team's leader registers for a scrim and gets a slot number once approved." },
];

function HowItWorks() {
  return (
    <section data-tour="how-it-works" className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <h2 className="relative mb-5 font-display text-2xl font-bold">How 7xen works</h2>
      <ol className="relative grid gap-4 md:grid-cols-3 md:gap-6">
        {STEPS.map((s, i) => (
          <motion.li key={s.title} {...fade(i + 3)} className="relative flex gap-4 md:flex-col md:gap-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-gradient-to-b from-primary/25 to-primary/5 text-primary [&_svg]:size-6">
              {s.icon}
              <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{i + 1}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="absolute top-3.5 right-0 hidden size-5 text-primary/60 md:block lg:-right-3" aria-hidden />
            )}
            <div>
              <div className="font-display text-lg font-bold">{s.title}</div>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function RecentRow({ r }: { r: { name: string; tag?: string; sub: string; active?: boolean; when: string } }) {
  return (
    <>
      <TeamAvatar name={r.name} tag={r.tag} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.name}</div>
        <div className="truncate text-xs text-muted-foreground">{r.sub}</div>
      </div>
      <div className="hidden text-right text-xs text-muted-foreground sm:block">{r.when}</div>
      {r.active !== undefined && <ActivePill active={r.active} />}
    </>
  );
}

function RecentList({ title, to, empty, loading, rows }: { title: string; to: string; empty: ReactNode; loading: boolean; rows: { id: string; name: string; tag?: string; sub: string; active?: boolean; when: string; to?: string }[] }) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <Button asChild variant="ghost" size="sm">
          <Link to={to}>
            View all <ArrowRight />
          </Link>
        </Button>
      </div>
      {loading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id}>
              {r.to ? (
                <Link to={r.to} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                  <RecentRow r={r} />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">
                  <RecentRow r={r} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-5 text-sm text-muted-foreground">{empty}</div>
      )}
    </section>
  );
}

function ReaderCard() {
  const status = useExtractorStatus({ refetchInterval: 30_000 });
  const samples = useSamples();
  const s = status.data;
  const online = !!s?.online;
  const unverified = samples.data?.items.filter((x) => !x.verified && !x.excluded).length ?? 0;
  const checked = samples.data?.items.filter((x) => x.verified && !x.excluded).length ?? 0;
  const loading = status.isPending;
  return (
    <Link
      to={unverified ? "/training/samples?status=unverified" : "/training/samples"}
      data-tour="reader-card"
      className="group relative flex flex-col gap-4 overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className={cn("relative flex size-12 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6", loading ? "bg-muted text-muted-foreground" : online ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
          {online || loading ? <Cpu /> : <PlugZap />}
          {online && <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full border-2 border-card bg-success" aria-hidden />}
        </div>
        <div className="min-w-0">
          <div className="font-display text-xl font-bold">Screenshot reader · Claude</div>
          <div className="text-sm text-muted-foreground">
            {loading ? (
              <Skeleton className="mt-1 h-4 w-48" />
            ) : online ? (
              <>Online · model <strong className="text-foreground">{s?.activeModel ?? "—"}</strong> · {checked} checked {checked === 1 ? "sample" : "samples"} in the test set</>
            ) : (
              "Offline — Claude CLI not found or not logged in. Managers can still type results by hand"
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {unverified > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-sm font-semibold text-warning-foreground dark:text-warning">
            <CircleDashed className="size-4" /> {unverified} {unverified === 1 ? "sample needs" : "samples need"} checking
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Training center</span>
        )}
        <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </Link>
  );
}

const newest = <T extends { createdAt: string }>(items: T[] | undefined) => [...(items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

export default function DashboardPage() {
  usePageTour("admin.dashboard", TOUR);
  const { user } = useAuth();
  const managers = useManagers();
  const teams = useTeams();

  return (
    <>
      <PageHeader eyebrow="Overview" title={<>Welcome back{user ? <>, <span className="text-gradient-brand">{user.displayName}</span></> : null}</>} description="Here's what's happening on 7xen right now." />
      <div className="space-y-6">
        <Stats />
        <div className="grid gap-4 md:grid-cols-2" data-tour="quick-actions">
          <QuickAction to="/managers?create=1" icon={<UserPlus />} title="Create manager login" text="For someone who will run scrims" />
          <QuickAction to="/players" icon={<UserRound />} title="See players" text="Everyone who signed up with Google" />
        </div>
        <TournamentsCard />
        <ReaderCard />
        <ManagerAppCard />
        <StationCard />
        <HowItWorks />
        <div className="grid gap-4 lg:grid-cols-2">
          <RecentList
            title="Newest managers"
            to="/managers"
            loading={managers.isPending}
            empty={<>No managers yet. <Link to="/managers?create=1" className="font-medium text-primary hover:underline">Create the first one</Link>.</>}
            rows={newest(managers.data?.items).map((m) => ({ id: m.id, name: m.displayName, sub: `@${m.username} · ${m.scrimCount} scrims`, active: m.isActive, when: `Added ${relativeTime(m.createdAt)}` }))}
          />
          <RecentList
            title="Newest teams"
            to="/teams"
            loading={teams.isPending}
            empty="No teams yet. Players create them after signing in with Google."
            rows={newest(teams.data?.items).map((t) => ({
              id: t.id,
              name: t.name,
              tag: t.tag,
              sub: `${t.leader ? `Led by ${t.leader.ign || t.leader.displayName} · ` : ""}${t.memberCount} ${t.memberCount === 1 ? "player" : "players"} · ${t.registrationCount} registrations`,
              when: `Created ${relativeTime(t.createdAt)}`,
              to: `/teams?team=${t.id}`,
            }))}
          />
        </div>
      </div>
    </>
  );
}

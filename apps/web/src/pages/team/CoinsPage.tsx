import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Crown, Gift, Lock, Medal, Receipt, Search, Swords, Trophy } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { CoinTransaction, CoinWallet } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { api } from "@/lib/api";
import { usePlayerSession } from "@/lib/auth";
import { NoTeamHint } from "@/features/player/components/NoTeamHint";
import { TeamLogo } from "@/features/player/components/TeamLogo";
import { QueryError } from "@/features/team/components/QueryError";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { BgCoin } from "@/features/coins/components/BgCoin";

const STEPS: TourStep[] = [
  { title: "Your BG coins", description: "Coins your team earned by winning matches and TDM battles." },
  { element: '[data-tour="coins-balance"]', title: "Balance", description: "Your team's total, its rank among all teams, and the leader the coins are credited to.", side: "bottom" },
  { element: '[data-tour="coins-redeem"]', title: "Redeem", description: "Swapping coins for rewards is coming soon. Your coins are kept safe until then.", side: "bottom" },
  { element: '[data-tour="coins-history"]', title: "Transactions", description: "Every award: which match or battle it was for and when. Tap one to see that match.", side: "top" },
];

const fmt = (n: number) => n.toLocaleString("en-IN");

function useCoinWallet() {
  return useQuery({ queryKey: ["team", "coins", "wallet"], queryFn: () => api.get<CoinWallet>("/api/team/coins"), staleTime: 30_000 });
}

/** /team/coins: the team's BG coin balance, transactions and (soon) redeeming. */
export default function CoinsPage() {
  usePageTour("team.coins", STEPS);
  const { hasTeam } = usePlayerSession();
  const q = useCoinWallet();
  const w = q.data;

  return (
    <>
      <PageHeader
        eyebrow="BG coins"
        title="Your coins"
        description="Win matches in scrims and tournaments, or become a TDM battle champion, to earn BG coins."
        actions={
          <Button asChild variant="outline">
            <Link to="/team#coins">
              <Trophy /> Top 10 teams
            </Link>
          </Button>
        }
      />

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your coins" />
      ) : !hasTeam ? (
        <NoTeamHint icon={<BgCoin className="size-6" />}>Coins are earned by teams. Create or join a team to start earning.</NoTeamHint>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Balance w={w} />
            <Redeem balance={w?.balance ?? 0} />
          </div>
          <History w={w} />
        </div>
      )}
    </>
  );
}

function Balance({ w }: { w: CoinWallet | undefined }) {
  return (
    <section data-tour="coins-balance" className="relative overflow-hidden rounded-2xl border border-warning/30 bg-card p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-warning/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <BgCoin className="size-20 sm:size-24" shine />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-[0.25em] text-muted-foreground uppercase">Team balance</p>
          {w ? (
            <p className="mt-1 font-display text-5xl leading-none font-bold tabular-nums sm:text-6xl">{fmt(w.balance)}</p>
          ) : (
            <Skeleton className="mt-2 h-12 w-40" />
          )}
          <p className="mt-1 text-sm text-muted-foreground">BG coins</p>
        </div>
        {w?.team && (
          <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 backdrop-blur">
            <TeamLogo name={w.team.name} tag={w.team.tag} logoUrl={w.team.logoUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{w.team.name}</p>
              {w.leader && <p className="truncate text-xs text-muted-foreground">Credited to leader {w.leader.ign ?? w.leader.displayName}</p>}
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-5 grid grid-cols-2 gap-2.5 sm:max-w-md">
        <Stat icon={<Medal />} label="Rank" value={w ? (w.rank ? `#${w.rank}` : "—") : null} />
        <Stat icon={<Swords />} label="Coin wins" value={w ? fmt(w.wins) : null} />
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="rounded-xl border bg-background/60 p-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5 [&_svg]:text-primary">
        {icon} {label}
      </span>
      {value == null ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{value}</p>}
    </div>
  );
}

/** Redeeming is planned; shown disabled so teams know it's coming. */
function Redeem({ balance }: { balance: number }) {
  return (
    <section data-tour="coins-redeem" className="flex flex-col gap-4 rounded-2xl border border-dashed bg-card/60 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Gift className="size-5" />
        </span>
        <div>
          <p className="flex items-center gap-2 font-display text-xl font-bold">
            Redeem coins
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Coming soon</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Soon you'll swap BG coins for rewards. Keep winning — your {fmt(balance)} coins are saved until then.</p>
        </div>
      </div>
      <Button size="lg" disabled className="mt-auto w-full" aria-describedby="redeem-soon">
        <Lock /> Redeem
      </Button>
      <p id="redeem-soon" className="-mt-2 text-center text-xs text-muted-foreground">
        Not available yet
      </p>
    </section>
  );
}

function History({ w }: { w: CoinWallet | undefined }) {
  return (
    <section data-tour="coins-history" className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
        <Receipt className="size-6 text-primary" /> Transactions
        {w && w.transactions.length > 0 && <span className="text-sm font-medium text-muted-foreground">({w.transactions.length})</span>}
      </h2>
      {!w ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : w.transactions.length === 0 ? (
        <EmptyState
          icon={<BgCoin className="size-8 opacity-70 grayscale" />}
          title="No coins yet"
          description="Win a match in a scrim or tournament that pays BG coins, or win a TDM battle. Every award shows up here."
          action={
            <Button asChild size="lg">
              <Link to="/team/scrims">
                <Search /> Find a scrim
              </Link>
            </Button>
          }
        />
      ) : (
        <StaggerList className="space-y-2">
          {w.transactions.map((t) => (
            <StaggerItem key={t.id}>
              <TxRow t={t} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}

function TxRow({ t }: { t: CoinTransaction }) {
  const champion = t.kind === "CHAMPION";
  const body = (
    <>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", champion ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary")}>
        {champion ? <Crown /> : <Swords />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{t.detail}</span>
        <span className="block text-[11px] text-muted-foreground">
          {format(parseISO(t.createdAt), "d MMM yyyy, h:mm a")} · to {t.creditedTo}
        </span>
      </span>
      <span className={cn("flex shrink-0 items-center gap-1.5 font-display text-lg font-bold tabular-nums", t.amount >= 0 ? "text-success" : "text-destructive")}>
        {t.amount >= 0 ? "+" : "−"}
        {fmt(Math.abs(t.amount))}
        <BgCoin className="size-5" />
      </span>
      {t.href && <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
    </>
  );
  const cls = "group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4";
  return t.href ? (
    <Link to={t.href} className={cn(cls, "outline-none transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

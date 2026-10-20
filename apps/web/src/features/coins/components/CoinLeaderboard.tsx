import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Coins, Crown, Drumstick } from "lucide-react";
import { BgCoin } from "./BgCoin";
import type { CoinLeaderboard as CoinLeaderboardData, CoinLeaderboardRow } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { api } from "@/lib/api";
import { TeamLogo } from "@/features/player/components/TeamLogo";
import { SectionHeader } from "@/features/team/home/SectionHeader";
import { QueryError } from "@/features/team/components/QueryError";

export const coinKeys = { leaderboard: ["team", "coins", "leaderboard"] as const };

export function useCoinLeaderboard() {
  return useQuery({
    queryKey: coinKeys.leaderboard,
    queryFn: () => api.get<CoinLeaderboardData>("/api/team/coins/leaderboard"),
    staleTime: 60_000,
  });
}

const fmt = (n: number) => n.toLocaleString("en-IN");

const RANK_TONE: Record<number, string> = {
  1: "bg-warning/20 text-warning-foreground ring-1 ring-warning/50 dark:text-warning",
  2: "bg-muted text-foreground ring-1 ring-border",
  3: "bg-primary/10 text-primary ring-1 ring-primary/30",
};

function Row({ r, mine }: { r: CoinLeaderboardRow; mine: boolean }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
        mine ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold tabular-nums",
          RANK_TONE[r.rank] ?? "text-muted-foreground",
        )}
      >
        {r.rank === 1 ? <Crown className="size-4" aria-label="1st" /> : r.rank}
      </span>
      <TeamLogo name={r.team.name} tag={r.team.tag} logoUrl={r.team.logoUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {r.team.name}
          {mine && <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground uppercase">You</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          Leader {r.leader.ign ?? r.leader.displayName} · {r.wins} {r.wins === 1 ? "win" : "wins"}
        </p>
      </div>
      <p className="flex shrink-0 items-center gap-1.5 font-display text-lg font-bold tabular-nums">
        <BgCoin className="size-5" /> {fmt(r.coins)}
      </p>
    </li>
  );
}

/** Home: total BG coins distributed and the top 10 teams by coins earned. */
export function CoinLeaderboard() {
  const q = useCoinLeaderboard();
  const d = q.data;
  const myId = d?.myTeam?.team.id;
  const myInTop = !!myId && !!d?.top.some((r) => r.team.id === myId);
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  // arriving from the sidebar coins card (/team#coins): bring the board into view once it has loaded
  useEffect(() => {
    if (hash === "#coins" && d) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, d]);

  return (
    <section ref={ref} id="coins" className="scroll-mt-24 space-y-4" data-tour="coins">
      <SectionHeader eyebrow="BG coins" title="Top 10 teams" icon={<Coins />} description="Win a match to earn BG coins. They're credited to your team's leader." />
      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the BG coins board" className="rounded-2xl border bg-card py-8" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-warning/20 blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
            <div className="relative">
              <BgCoin className="size-12" shine />
              <p className="mt-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Total coins distributed</p>
              {d ? (
                <p className="mt-1 font-display text-4xl leading-none font-bold tabular-nums sm:text-5xl">{fmt(d.totalDistributed)}</p>
              ) : (
                <Skeleton className="mt-2 h-10 w-32" />
              )}
              <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Drumstick className="size-4 text-primary" />
                {d ? `${fmt(d.totalWins)} ${d.totalWins === 1 ? "match" : "matches"} won` : "…"}
              </p>
              {d?.myTeam && (
                <p className="mt-4 rounded-xl border bg-background/60 px-3 py-2 text-sm">
                  Your team: <span className="font-display font-bold">{fmt(d.myTeam.coins)}</span> coins · rank #{d.myTeam.rank}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-2 shadow-sm sm:p-3">
            {!d ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : d.top.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
                <BgCoin className="size-10 opacity-60 grayscale" />
                <p className="font-semibold">No coins awarded yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">Win a match in a scrim or tournament that pays BG coins, and your team shows up here.</p>
              </div>
            ) : (
              <ol className="space-y-1">
                {d.top.map((r) => (
                  <Row key={r.team.id} r={r} mine={r.team.id === myId} />
                ))}
                {d.myTeam && !myInTop && (
                  <>
                    <li aria-hidden className="mx-3 border-t border-dashed" />
                    <Row r={d.myTeam} mine />
                  </>
                )}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

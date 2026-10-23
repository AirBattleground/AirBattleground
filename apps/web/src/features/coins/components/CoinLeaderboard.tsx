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
import { useT } from "@/i18n/core";
import { coinsMsg } from "@/i18n/coins";

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
  const t = useT(coinsMsg);
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
        {r.rank === 1 ? <Crown className="size-4" aria-label={t("first")} /> : r.rank}
      </span>
      <TeamLogo name={r.team.name} tag={r.team.tag} logoUrl={r.team.logoUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {r.team.name}
          {mine && <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground uppercase">{t("you")}</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t.plural("leader_wins", r.wins, { name: r.leader.ign ?? r.leader.displayName })}
        </p>
      </div>
      <p className="flex shrink-0 items-center gap-1.5 font-display text-lg font-bold tabular-nums">
        <BgCoin className="size-5" /> {fmt(r.coins)}
      </p>
    </li>
  );
}

/** Home: total BG coins distributed and the top 10 teams by coins earned (one compact card until any are awarded). */
export function CoinLeaderboard() {
  const t = useT(coinsMsg);
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
      <SectionHeader eyebrow={t("lb_eyebrow")} title={t("lb_title")} icon={<Coins />} description={t("lb_text")} />
      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("lb_error")} className="rounded-2xl border bg-card py-8" />
      ) : d && d.top.length === 0 ? (
        // nothing awarded yet: one compact card instead of a "0" total beside an empty list
        <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <BgCoin className="size-10 shrink-0 opacity-60 grayscale" />
          <div className="min-w-0">
            <p className="font-semibold">{t("none_title")}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("none_text")}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-warning/20 blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
            <div className="relative">
              <BgCoin className="size-12" shine />
              <p className="mt-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("total_distributed")}</p>
              {d ? (
                <p className="mt-1 font-display text-4xl leading-none font-bold tabular-nums sm:text-5xl">{fmt(d.totalDistributed)}</p>
              ) : (
                <Skeleton className="mt-2 h-10 w-32" />
              )}
              <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Drumstick className="size-4 text-primary" />
                {d ? t.plural("matches_won", d.totalWins, { count: fmt(d.totalWins) }) : "…"}
              </p>
              {d?.myTeam && (
                <p className="mt-4 rounded-xl border bg-background/60 px-3 py-2 text-sm">
                  {t.rich("your_team_line", { b: (c) => <span className="font-display font-bold">{c}</span> }, { coins: fmt(d.myTeam.coins), rank: d.myTeam.rank })}
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

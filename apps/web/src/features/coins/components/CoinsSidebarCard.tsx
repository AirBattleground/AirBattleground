import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { usePlayerSession } from "@/lib/auth";
import type { SidebarSlotState } from "@/components/shell/types";
import { BgCoin } from "./BgCoin";
import { useCoinLeaderboard } from "./CoinLeaderboard";

const fmt = (n: number) => n.toLocaleString("en-IN");

/** Sidebar "BG coins" card: the team's coins + rank, linking to the coins page (balance, transactions, redeem). */
export function CoinsSidebarCard({ collapsed }: SidebarSlotState) {
  const { team } = usePlayerSession();
  const q = useCoinLeaderboard();
  const mine = q.data?.myTeam ?? null;
  const coins = mine?.coins ?? 0;
  const line = !team ? "Join a team to earn coins" : mine ? `Rank #${mine.rank} · ${mine.wins} ${mine.wins === 1 ? "win" : "wins"}` : "Win a match to earn coins";

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/team/coins"
            aria-label={`BG coins: ${fmt(coins)}`}
            className="ml-1 flex size-[44px] items-center justify-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          >
            <BgCoin className="size-9" shine />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          {fmt(coins)} BG coins · {line}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      to="/team/coins"
      data-tour="coins-card"
      aria-label={`BG coins: ${fmt(coins)}. ${line}`}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-warning/30 bg-card/70 px-3.5 py-3 shadow-lg shadow-background/40 backdrop-blur-md outline-none transition-colors hover:border-warning/60 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
    >
      <span aria-hidden className="pointer-events-none absolute -top-8 -left-6 size-24 rounded-full bg-warning/20 blur-2xl transition-opacity group-hover:opacity-100" />
      <BgCoin className="relative size-10 transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" shine />
      <span className="relative min-w-0 flex-1">
        <span className="block text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">BG coins</span>
        {q.data ? (
          <span className="block font-display text-2xl leading-none font-bold tabular-nums">{fmt(coins)}</span>
        ) : (
          <span className="mt-1 block h-6 w-14 animate-pulse rounded bg-muted" />
        )}
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">{line}</span>
      </span>
      <ChevronRight className="relative size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

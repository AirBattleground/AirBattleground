import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Crown, Gift, Search, Swords, Trophy } from "lucide-react";
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
import { useDateFormat, useT } from "@/i18n/core";
import { coinsMsg } from "@/i18n/coins";

const fmt = (n: number) => n.toLocaleString("en-IN");

function useCoinWallet() {
  return useQuery({ queryKey: ["team", "coins", "wallet"], queryFn: () => api.get<CoinWallet>("/api/team/coins"), staleTime: 30_000 });
}

/** /team/coins: two zones — the wallet (balance, rank, redeem soon) and the transaction history. */
export default function CoinsPage() {
  const t = useT(coinsMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_intro_title"), description: t("tour_intro_text") },
      { element: '[data-tour="coins-balance"]', title: t("tour_balance_title"), description: t("tour_balance_text"), side: "bottom" },
      { element: '[data-tour="coins-redeem"]', title: t("tour_redeem_title"), description: t("tour_redeem_text"), side: "bottom" },
      { element: '[data-tour="coins-history"]', title: t("tour_history_title"), description: t("tour_history_text"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.coins", steps);
  const { hasTeam } = usePlayerSession();
  const q = useCoinWallet();
  const w = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("bg_coins")}
        title={t("title")}
        description={t("description")}
        className="mb-0"
        actions={
          <Button asChild variant="outline">
            <Link to="/team#coins">
              <Trophy /> {t("top10")}
            </Link>
          </Button>
        }
      />

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />
      ) : !hasTeam ? (
        <NoTeamHint icon={<BgCoin className="size-6" />}>{t("no_team")}</NoTeamHint>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
          <WalletPanel w={w} />
          <History w={w} />
        </div>
      )}
    </div>
  );
}

const LABEL = "text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase";

/** Left zone: balance (big), rank + wins (small), who it's credited to, and redeeming (coming soon). */
function WalletPanel({ w }: { w: CoinWallet | undefined }) {
  const t = useT(coinsMsg);
  return (
    <aside className="relative overflow-hidden rounded-2xl border border-warning/30 bg-card shadow-sm">
      <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-warning/20 blur-3xl" />
      <section data-tour="coins-balance" className="relative space-y-4 p-4 sm:p-5">
        <p className={LABEL}>{t("team_balance")}</p>
        <div className="flex items-center gap-4">
          <BgCoin className="size-16 shrink-0" shine />
          {w ? (
            <p className="font-display text-5xl leading-none font-bold tabular-nums">{fmt(w.balance)}</p>
          ) : (
            <Skeleton className="h-12 w-36" />
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t("rank")}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{w ? (w.rank ? `#${w.rank}` : "—") : "…"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("coin_wins")}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{w ? fmt(w.wins) : "…"}</dd>
          </div>
        </dl>
        {w?.team && (
          <div className="flex items-center gap-3 border-t pt-4">
            <TeamLogo name={w.team.name} tag={w.team.tag} logoUrl={w.team.logoUrl} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{w.team.name}</p>
              {w.leader && <p className="truncate text-xs text-muted-foreground">{t("credited_to", { name: w.leader.ign ?? w.leader.displayName })}</p>}
            </div>
          </div>
        )}
      </section>
      {/* redeeming is planned; shown so teams know it's coming */}
      <section data-tour="coins-redeem" className="relative flex items-start gap-3 border-t border-dashed p-4 sm:px-5">
        <Gift className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {t("redeem_title")}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{t("coming_soon")}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("redeem_text", { coins: fmt(w?.balance ?? 0) })}</p>
        </div>
      </section>
    </aside>
  );
}

function History({ w }: { w: CoinWallet | undefined }) {
  const t = useT(coinsMsg);
  return (
    <section data-tour="coins-history" className="rounded-2xl border bg-card">
      <h2 className={cn(LABEL, "flex items-center gap-2 px-4 pt-4 pb-2 sm:px-5")}>
        {t("transactions")}
        {w && w.transactions.length > 0 && <span className="tabular-nums">· {w.transactions.length}</span>}
      </h2>
      {!w ? (
        <div className="space-y-2 p-4 pt-2 sm:p-5 sm:pt-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : w.transactions.length === 0 ? (
        <EmptyState
          className="border-0 bg-transparent"
          icon={<BgCoin className="size-8 opacity-70 grayscale" />}
          title={t("no_coins_title")}
          description={t("no_coins_text")}
          action={
            <Button asChild size="lg">
              <Link to="/team/scrims">
                <Search /> {t("find_scrim")}
              </Link>
            </Button>
          }
        />
      ) : (
        <StaggerList className="divide-y px-2 pb-2">
          {w.transactions.map((tx) => (
            <StaggerItem key={tx.id}>
              <TxRow t={tx} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}

function TxRow({ t }: { t: CoinTransaction }) {
  const tr = useT(coinsMsg);
  const fmtDate = useDateFormat();
  const champion = t.kind === "CHAMPION";
  const body = (
    <>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5", champion ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary")}>
        {champion ? <Crown /> : <Swords />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {fmtDate(t.createdAt, "d MMM, h:mm a")}
          {t.detail && ` · ${t.detail}`}
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
  const cls = "group flex items-center gap-3 rounded-lg px-2 py-3 sm:px-3";
  const credited = tr("to", { name: t.creditedTo });
  return t.href ? (
    <Link to={t.href} title={credited} className={cn(cls, "outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
      {body}
    </Link>
  ) : (
    <div title={credited} className={cls}>
      {body}
    </div>
  );
}

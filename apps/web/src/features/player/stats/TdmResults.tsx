import type { ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Crosshair, Swords, Trophy } from "lucide-react";
import { MAP_LABELS, type GameMap, type PlayerStatsPeriod, type TdmBattle } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { QueryError } from "@/features/team/components/QueryError";
import { useT, type T as Translator } from "@/i18n/core";
import { statsMsg } from "@/i18n/playerStats";
import { useTdmStats } from "./api";

type T = Translator<typeof statsMsg.en>;

const mapName = (m: string) => MAP_LABELS[m as GameMap] ?? m;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function Headline({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 px-1 py-4 text-center sm:px-3 sm:py-5">
      <p className="truncate text-[9px] font-semibold tracking-wide text-muted-foreground uppercase sm:text-xs sm:tracking-[0.12em]">{label}</p>
      <p className="mt-1 font-display text-3xl leading-none font-bold tabular-nums sm:text-5xl">{value}</p>
    </div>
  );
}

function BattleRow({ b, t }: { b: TdmBattle; t: T }) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3">
      <span
        className={cn(
          "rounded-md px-2 py-1 text-center text-[11px] font-bold tracking-wide uppercase",
          b.won == null ? "bg-muted text-muted-foreground" : b.won ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
        )}
      >
        {b.won == null ? "—" : b.won ? t("tdm_won") : t("tdm_lost")}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold">{t("tdm_vs", { team: b.teamName ?? "—", opp: b.opponentName ?? "—" })}</p>
        <p className="truncate text-xs text-muted-foreground">
          {format(parseISO(b.playedAt), "d MMM")} · {mapName(b.map)} · {b.eventTitle}
        </p>
      </div>
      <div className="text-right">
        <p className="font-display text-lg leading-none font-bold tabular-nums">{t.plural("kills_n", b.kills)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{t("tdm_score", { team: b.teamKills ?? "—", opp: b.opponentKills ?? "—" })}</p>
      </div>
    </li>
  );
}

/** TDM Results: the player's TDM battles — never mixed into the battle royale stats. */
export function TdmResults({ period }: { period: PlayerStatsPeriod }) {
  const t = useT(statsMsg);
  const q = useTdmStats(period);
  const s = q.data;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_err")} />;
  if (!s)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  if (s.battles === 0)
    return <EmptyState icon={<Swords />} title={t("tdm_empty_title")} description={period === "ALL_TIME" ? t("tdm_empty_desc") : t("empty_filter")} />;
  return (
    <div className={cn("space-y-4 transition-opacity", q.isPlaceholderData && "opacity-60")}>
      <div className="overflow-hidden rounded-2xl border">
        <div className="grid grid-cols-5 divide-x bg-muted/50">
          <Headline label={t("tdm_battles")} value={s.battles} />
          <Headline label={t("wins")} value={s.wins} />
          <Headline label={t("tdm_losses")} value={s.losses} />
          <Headline label={t("kills")} value={s.kills} />
          <Headline label={t("tdm_kpb")} value={s.killsPerBattle.toFixed(1)} />
        </div>
        <div className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] items-center gap-2 px-2 py-4 sm:grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] sm:px-4">
          <span className="flex justify-center text-primary [&_svg]:size-6 sm:[&_svg]:size-7">
            <Trophy />
          </span>
          {[
            { label: t("win_rate"), value: pct(s.winRate) },
            { label: t("kill_share"), value: s.killShare != null ? pct(s.killShare) : "—" },
            { label: t("tdm_best"), value: s.best ? t("tdm_best_val", { kills: s.best.kills, opp: s.best.opponentName ?? "—" }) : "—" },
          ].map((it) => (
            <div key={it.label} className="min-w-0 text-center">
              <p className="text-[11px] leading-tight text-muted-foreground sm:truncate sm:text-xs">{it.label}</p>
              <p className="mt-0.5 font-display text-base leading-tight font-bold break-words tabular-nums sm:truncate sm:text-2xl">{it.value}</p>
            </div>
          ))}
        </div>
      </div>
      <section className="rounded-2xl border p-4" aria-labelledby="tdm-recent">
        <h3 id="tdm-recent" className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          <Crosshair className="size-3.5" /> {t("tdm_recent")}
        </h3>
        <ul className="divide-y">
          {s.recent.map((b) => (
            <BattleRow key={b.matchId} b={b} t={t} />
          ))}
        </ul>
      </section>
    </div>
  );
}

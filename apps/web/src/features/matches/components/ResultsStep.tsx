import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownUp, Info, Save, Scale, ShieldAlert, Trophy } from "lucide-react";
import { matchPoints, type MatchDetail, type MatchTeamRow, type SaveResultsInput } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { PODIUM } from "@/features/results/components/Rank";
import { usePublishMatch, useSaveResults } from "../api";

const pad = (n: number) => String(n).padStart(2, "0");

export interface ResultsDraft {
  placement: Record<number, number | null>;
  /** `${slot}:${position}` → finishes */
  pkills: Record<string, number | null>;
  /** manual team finishes override */
  tkills: Record<number, number | null>;
  /** TDM tie: why the manager picked the winner (undefined = unchanged) */
  tieNote?: string;
}
export const emptyResultsDraft = (): ResultsDraft => ({ placement: {}, pkills: {}, tkills: {} });
export const resultsDirty = (d: ResultsDraft) =>
  Object.keys(d.placement).length > 0 || Object.keys(d.pkills).length > 0 || Object.keys(d.tkills).length > 0 || d.tieNote !== undefined;

interface Eff {
  row: MatchTeamRow;
  placement: number | null;
  players: { position: number; name: string; kills: number | null }[];
  playerSum: number | null;
  kills: number | null;
}

function effective(row: MatchTeamRow, d: ResultsDraft): Eff {
  const slot = row.slotNumber;
  const players = row.players.map((p) => {
    const k = `${slot}:${p.position}`;
    return { position: p.position, name: p.name, kills: k in d.pkills ? (d.pkills[k] ?? null) : p.kills };
  });
  const withKills = players.filter((p) => p.kills != null);
  const playerSum = withKills.length ? withKills.reduce((s, p) => s + (p.kills ?? 0), 0) : null;
  const playerEdited = row.players.some((p) => `${slot}:${p.position}` in d.pkills);
  const kills = slot in d.tkills ? (d.tkills[slot] ?? null) : playerEdited ? playerSum : (row.kills ?? playerSum);
  const placement = slot in d.placement ? (d.placement[slot] ?? null) : row.placement;
  return { row, placement, players, playerSum, kills };
}

function resultsInput(m: MatchDetail, d: ResultsDraft): SaveResultsInput {
  return {
    teams: m.teams.map((row) => {
      const e = effective(row, d);
      return {
        slotNumber: row.slotNumber,
        placement: e.placement,
        kills: e.kills,
        players: e.players.map((p) => ({ position: p.position, kills: p.kills })),
      };
    }),
    ...(d.tieNote !== undefined ? { tieNote: d.tieNote.trim() } : {}),
  };
}

function NumInput({ value, onChange, label, className, disabled }: { value: number | null; onChange: (v: number | null) => void; label: string; className?: string; disabled?: boolean }) {
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      value={value ?? ""}
      placeholder="–"
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        onChange(raw === "" ? null : Math.min(99, Number(raw)));
      }}
      className={cn(
        "h-8 w-11 rounded-md border bg-background text-center font-display text-base font-bold tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
        className,
      )}
    />
  );
}

export function ResultsStep({
  m,
  draft,
  setDraft,
  readOnly,
}: {
  m: MatchDetail;
  draft: ResultsDraft;
  setDraft: (fn: (d: ResultsDraft) => ResultsDraft) => void;
  readOnly: boolean;
}) {
  const save = useSaveResults(m.match.id);
  const publish = usePublishMatch(m.match.id);
  const [confirming, setConfirming] = useState(false);
  const [order, setOrder] = useState<"rank" | "slot">("rank");
  const ps = m.scrim.pointsSystem;
  const dirty = resultsDirty(draft);

  // Order follows the saved data (not live edits) so rows don't jump while typing.
  const rows = useMemo(() => {
    const list = [...m.teams];
    if (order === "rank") list.sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99) || a.slotNumber - b.slotNumber);
    else list.sort((a, b) => a.slotNumber - b.slotNumber);
    return list.map((r) => effective(r, draft));
  }, [m.teams, draft, order]);

  const maxRank = Math.max(m.teams.length, ...rows.map((r) => r.placement ?? 0), 1);
  const rankCounts = new Map<number, number>();
  rows.forEach((r) => r.placement != null && rankCounts.set(r.placement, (rankCounts.get(r.placement) ?? 0) + 1));
  const dupRanks = [...rankCounts.entries()].filter(([, n]) => n > 1).map(([r]) => r).sort((a, b) => a - b);
  // slots without a registered team don't count on the points table, so they don't need a rank
  const noRank = rows.filter((r) => r.placement == null && r.row.team).length;
  const mismatches = rows.filter((r) => r.playerSum != null && r.kills != null && r.playerSum !== r.kills).length;
  // TDM: a kills tie can't pick the winner, so the manager does (rank 1) and writes why — teams see the reason
  const teamRows = rows.filter((r) => r.row.team);
  const tied = !!m.isTdm && teamRows.length === 2 && (teamRows[0]!.kills ?? 0) === (teamRows[1]!.kills ?? 0) && teamRows.some((r) => r.kills != null);
  const tieNote = draft.tieNote ?? m.tieNote ?? "";
  const blockers = [
    noRank > 0 && `${noRank} team${noRank === 1 ? " has" : "s have"} no rank`,
    dupRanks.length > 0 && `Rank ${dupRanks.join(", ")} ${dupRanks.length === 1 ? "is" : "are"} used more than once`,
    tied && !tieNote.trim() && "Tie — pick the winner and say why",
  ].filter(Boolean) as string[];

  const doSave = () => save.mutate(resultsInput(m, draft), { onSuccess: () => setDraft(emptyResultsDraft) });
  const doPublish = async () => {
    try {
      if (dirty) {
        await save.mutateAsync({ ...resultsInput(m, draft), silent: true });
        setDraft(emptyResultsDraft);
      }
      publish.mutate();
    } catch {
      /* toast from mutation */
    }
  };

  if (m.teams.length === 0)
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No teams in the lineup yet. Confirm the team list first.
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-tour="results-summary">
        <span>
          <span className="font-display text-2xl font-bold">{rows.filter((r) => r.placement != null).length}</span>
          <span className="text-muted-foreground">/{rows.length} ranked</span>
        </span>
        {dupRanks.length > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-destructive">
            <AlertTriangle className="size-3.5" /> Rank {dupRanks.join(", ")} used twice
          </span>
        )}
        {mismatches > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-warning-foreground dark:text-warning">
            <AlertTriangle className="size-3.5" /> {mismatches} finish total{mismatches === 1 ? "" : "s"} to check
          </span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOrder((o) => (o === "rank" ? "slot" : "rank"))}>
          <ArrowDownUp /> Sort by {order === "rank" ? "slot" : "rank"}
        </Button>
      </div>

      {m.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {m.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" /> {w}
            </li>
          ))}
        </ul>
      )}

      {tied && (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4" data-tour="results-tie">
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <Scale className="size-5 text-primary" /> Tie — {teamRows[0]!.kills ?? 0} kills each
          </p>
          <p className="text-sm text-muted-foreground">
            Only one team can win. Give the winner <strong className="text-foreground">Rank 1</strong> below, then write why. Both teams will see this reason.
          </p>
          <Textarea
            value={tieNote}
            disabled={readOnly}
            maxLength={200}
            rows={2}
            placeholder="e.g. Won the tie-break 1v1 · Fewer deaths · Higher-ranked seed"
            aria-label="Why this team wins the tie"
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => ({ ...d, tieNote: v }));
            }}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-tour="results-table">
        <div className="hidden grid-cols-[6rem_minmax(0,13rem)_minmax(0,1fr)_6.5rem_7rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:grid">
          <span>Rank</span>
          <span>Team</span>
          <span>Players · finishes</span>
          <span className="text-center">Team finishes</span>
          <span className="text-right">Points</span>
        </div>
        <ul className="divide-y">
          {rows.map((e) => {
            const slot = e.row.slotNumber;
            const dup = e.placement != null && dupRanks.includes(e.placement);
            const mismatch = e.playerSum != null && e.kills != null && e.playerSum !== e.kills;
            const pts = e.placement != null ? matchPoints(ps, e.placement, e.kills ?? 0) : null;
            const flags = e.row.flags.filter((f) => !/kills total|differs from players|duplicate/i.test(f));
            return (
              <li
                key={slot}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 lg:grid-cols-[6rem_minmax(0,13rem)_minmax(0,1fr)_6.5rem_7rem]",
                  e.placement != null && PODIUM[e.placement]?.row,
                  (dup || (e.placement == null && e.row.team)) && "bg-destructive/[0.04]",
                )}
              >
                <div>
                  <Select
                    disabled={readOnly}
                    value={e.placement != null ? String(e.placement) : ""}
                    onValueChange={(v) => setDraft((d) => ({ ...d, placement: { ...d.placement, [slot]: Number(v) } }))}
                  >
                    <SelectTrigger
                      aria-label={`Rank for slot ${slot}`}
                      className={cn(
                        "h-11 w-20 font-display text-xl font-bold",
                        dup && "border-destructive text-destructive",
                        e.placement == null && "border-dashed",
                      )}
                    >
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {Array.from({ length: maxRank }, (_, i) => i + 1).map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          #{r}
                          {(rankCounts.get(r) ?? 0) > 0 && r !== e.placement ? " · taken" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dup && <p className="mt-0.5 text-[11px] font-semibold text-destructive">Used twice</p>}
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  {e.row.team ? (
                    <TeamAvatar name={e.row.team.name} tag={e.row.team.tag} size="sm" />
                  ) : (
                    <ShieldAlert className="size-5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p className={cn("truncate font-semibold", !e.row.team && "text-destructive")}>{e.row.team?.name ?? "No team registered"}</p>
                    <p className="font-display text-xs font-semibold text-muted-foreground">Slot #{pad(slot)}</p>
                  </div>
                </div>

                <div className="col-span-3 flex flex-wrap gap-1.5 lg:col-span-1">
                  {e.players.length === 0 && <span className="text-xs text-muted-foreground">No names — enter team finishes</span>}
                  {e.players.map((p) => (
                    <label key={p.position} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background/70 py-0.5 pr-0.5 pl-2 text-xs">
                      <span className="max-w-32 truncate font-medium" title={p.name}>
                        {p.name}
                      </span>
                      <NumInput
                        disabled={readOnly}
                        label={`Finishes for ${p.name}`}
                        value={p.kills}
                        className="h-7 w-9 text-sm"
                        onChange={(v) => setDraft((d) => ({ ...d, pkills: { ...d.pkills, [`${slot}:${p.position}`]: v } }))}
                      />
                    </label>
                  ))}
                  {flags.map((f, i) => (
                    <span key={i} className="flex w-full items-center gap-1 text-[11px] text-warning-foreground dark:text-warning">
                      <AlertTriangle className="size-3" /> {f}
                    </span>
                  ))}
                </div>

                <div className="col-start-1 row-start-3 flex flex-col items-start lg:col-start-auto lg:row-start-auto lg:items-center">
                  <div className="flex items-center gap-1">
                    <NumInput
                      disabled={readOnly}
                      label={`Team finishes for slot ${slot}`}
                      value={e.kills}
                      className={cn("h-9 w-12 text-lg", mismatch && "border-warning bg-warning/10")}
                      onChange={(v) => setDraft((d) => ({ ...d, tkills: { ...d.tkills, [slot]: v } }))}
                    />
                    <span className="text-[10px] text-muted-foreground lg:hidden">team finishes</span>
                  </div>
                  {mismatch ? (
                    <button
                      type="button"
                      disabled={readOnly}
                      className="mt-0.5 text-[11px] font-semibold text-warning-foreground underline-offset-2 hover:underline dark:text-warning"
                      onClick={() => setDraft((d) => ({ ...d, tkills: { ...d.tkills, [slot]: e.playerSum } }))}
                      title="Use the players' total"
                    >
                      Players add up to {e.playerSum}
                    </button>
                  ) : null}
                </div>

                <div className="col-start-3 row-start-1 text-right lg:col-start-auto lg:row-start-auto">
                  {pts ? (
                    <>
                      <p className="font-display text-3xl font-bold leading-none tabular-nums">{pts.totalPoints}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {pts.placementPoints} place + {pts.killPoints} fin
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {!readOnly && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-20 lg:bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur" data-tour="results-publish">
          <div className="text-sm">
            {blockers.length > 0 ? (
              <p className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="size-4" /> {blockers.join(" · ")}
              </p>
            ) : (
              <p className="text-muted-foreground">{dirty ? "Unsaved changes." : "All ranked — ready to publish."}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" aria-label="Save draft" disabled={!dirty || save.isPending} onClick={doSave}>
              <Save /> <span className="hidden sm:inline">{save.isPending ? "Saving…" : "Save draft"}</span>
            </Button>
            <Button size="lg" className="shadow-glow" disabled={blockers.length > 0 || publish.isPending || save.isPending} onClick={() => setConfirming(true)}>
              <Trophy /> {publish.isPending ? "Publishing…" : "Publish results"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Publish Match ${m.match.number} results?`}
        description="Every team sees the scorecard and the updated points table. You can unpublish later."
        confirmLabel="Publish results"
        onConfirm={() => void doPublish()}
      />
    </div>
  );
}

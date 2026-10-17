import { useCallback, useMemo, useSyncExternalStore } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ManagerTournamentDetail, StageDetail } from "@7xen/shared";
import { tKeys } from "./api";

const LABELS = { new: "New tournament", edit: "Edit", stages: "Stages", matches: "Matches" };

/**
 * Breadcrumb labels for the tournament section: names instead of "Details" for ids that are already cached
 * (tournament title, stage name, match number). Reads the cache only — never fetches.
 */
export function useTournamentCrumbLabels(): Record<string, string> | null {
  const { pathname } = useLocation();
  const m = matchPath({ path: "/manager/tournaments/:tournamentId/*" }, pathname);
  const tId = m?.params.tournamentId && m.params.tournamentId !== "new" ? m.params.tournamentId : "";
  const sm = matchPath({ path: "/manager/tournaments/:tournamentId/stages/:stageId/*" }, pathname);
  const sId = sm?.params.stageId ?? "";
  const mm = matchPath({ path: "/manager/tournaments/:tournamentId/stages/:stageId/matches/:matchId" }, pathname);
  const mId = mm?.params.matchId ?? "";

  const qc = useQueryClient();
  const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
  const version = useSyncExternalStore(
    subscribe,
    () => `${qc.getQueryState(tKeys.detail(tId))?.dataUpdatedAt ?? 0}:${qc.getQueryState(tKeys.stage(tId, sId))?.dataUpdatedAt ?? 0}`,
  );
  const t = { data: tId ? qc.getQueryData<ManagerTournamentDetail>(tKeys.detail(tId)) : undefined };
  const s = { data: tId && sId ? qc.getQueryData<StageDetail>(tKeys.stage(tId, sId)) : undefined };
  const inSection = pathname.startsWith("/manager/tournaments");

  return useMemo(() => {
    if (!inSection) return null;
    const out: Record<string, string> = { ...LABELS };
    if (tId && t.data) out[tId] = t.data.title;
    if (sId) {
      const name = s.data?.stage.name ?? t.data?.stages.find((x) => x.id === sId)?.name;
      if (name) out[sId] = name;
    }
    if (mId && s.data) {
      for (const g of s.data.groups) {
        const match = g.matches.find((x) => x.id === mId);
        if (match) out[mId] = `Group ${g.name} · Match ${match.number}`;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSection, tId, sId, mId, version]);
}

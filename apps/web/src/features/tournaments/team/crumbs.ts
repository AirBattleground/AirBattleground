import { useCallback, useMemo, useSyncExternalStore } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { StageDetail, TeamTournamentDetail } from "@7xen/shared";
import { tournamentKeys } from "./api";

const LABELS = { stages: "Stages", matches: "Match" };

/**
 * Breadcrumb labels for the team tournament section: tournament title / stage name instead of "Details"
 * for ids already in the cache. Reads the cache only — never fetches. Returns null outside the section.
 */
export function useTeamTournamentCrumbLabels(base: Record<string, string>): Record<string, string> | null {
  const { pathname } = useLocation();
  const tm = matchPath({ path: "/team/tournaments/:id/*" }, pathname);
  const tId = tm?.params.id ?? "";
  const sm = matchPath({ path: "/team/tournaments/:id/stages/:stageId" }, pathname);
  const sId = sm?.params.stageId ?? "";
  const mm = matchPath({ path: "/team/tournaments/:id/matches/:matchId" }, pathname);
  const mId = mm?.params.matchId ?? "";
  const inSection = pathname.startsWith("/team/tournaments");

  const qc = useQueryClient();
  const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
  const version = useSyncExternalStore(
    subscribe,
    () => `${qc.getQueryState(tournamentKeys.detail(tId))?.dataUpdatedAt ?? 0}:${qc.getQueryState(tournamentKeys.stage(tId, sId))?.dataUpdatedAt ?? 0}`,
  );

  return useMemo(() => {
    if (!inSection) return null;
    const out: Record<string, string> = { ...base, ...LABELS };
    const t = tId ? qc.getQueryData<TeamTournamentDetail>(tournamentKeys.detail(tId)) : undefined;
    if (tId && t) out[tId] = t.title;
    if (sId) {
      const s = qc.getQueryData<StageDetail>(tournamentKeys.stage(tId, sId));
      const name = s?.stage.name ?? t?.stages.find((x) => x.id === sId)?.name;
      if (name) out[sId] = name;
    }
    if (mId) out[mId] = "Scorecard";
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSection, tId, sId, mId, version, base]);
}

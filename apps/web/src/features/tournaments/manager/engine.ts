/**
 * Client-side wrappers around the shared tournament engine for LIVE previews. The API is authoritative; these
 * never throw — if an engine function isn't available (or rejects odd input) a small local fallback or `null`
 * is returned so the UI can show a placeholder instead of crashing.
 */
import {
  addDays,
  DEFAULT_LOBBY_SIZE,
  groupName as engineGroupName,
  groupSizes as engineGroupSizes,
  planSchedule as enginePlanSchedule,
  suggestFormat as engineSuggestFormat,
  teamsOut as engineTeamsOut,
  validateFormat as engineValidateFormat,
  type FormatIssue,
  type GameMap,
  type ScheduleConfig,
  type SchedulePlan,
  type StageSpec,
} from "@7xen/shared";

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function teamsOut(stage: StageSpec, isLast: boolean): number {
  return attempt(() => engineTeamsOut(stage, isLast)) ?? (isLast ? 0 : stage.groupCount * stage.advancePerGroup + stage.wildcardCount);
}

export function groupSizes(teams: number, groups: number): number[] {
  const r = attempt(() => engineGroupSizes(teams, groups));
  if (r) return r;
  const g = Math.max(1, groups);
  const base = Math.floor(teams / g);
  const extra = teams % g;
  return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0));
}

export function groupName(index: number): string {
  const r = attempt(() => engineGroupName(index));
  if (r) return r;
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const DEFAULT_MAPS: GameMap[] = ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"];
const FINAL_MAPS: GameMap[] = ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL", "MIRAMAR", "ERANGEL"];

function stage(name: string, teamsIn: number, lobbySize: number, maps: GameMap[], advancePerGroup: number): StageSpec {
  return {
    name,
    teamsIn,
    lobbySize,
    groupCount: Math.max(1, Math.ceil(teamsIn / lobbySize)),
    matchesPerGroup: maps.length,
    maps,
    advancePerGroup,
    wildcardCount: 0,
    invitedSlots: 0,
    schedule: null,
  };
}

/** Local stand-in for suggestFormat (only used if the engine isn't available). */
function localSuggest(totalTeams: number, lobby: number, maps?: GameMap[]): StageSpec[] {
  const m = maps?.length ? maps : DEFAULT_MAPS;
  if (totalTeams <= lobby) return [stage("Final", totalTeams, lobby, FINAL_MAPS, 0)];
  const stages: StageSpec[] = [];
  let teams = totalTeams;
  const names = ["Qualifier", "Round 2", "Round 3", "Quarter-final", "Semi-final"];
  let i = 0;
  while (teams > lobby && stages.length < 5) {
    const groups = Math.ceil(teams / lobby);
    const target = groups <= 2 ? lobby : Math.max(lobby, Math.ceil(teams / 4 / lobby) * lobby);
    const advance = Math.max(1, Math.floor(target / groups));
    stages.push(stage(names[i++] ?? `Round ${i}`, teams, lobby, m, advance));
    teams = groups * advance;
  }
  if (stages.length >= 2) stages[stages.length - 1]!.name = "Semi-final";
  stages.push(stage("Final", teams, lobby, FINAL_MAPS, 0));
  return stages;
}

export function suggestFormat(totalTeams: number, lobbySize = DEFAULT_LOBBY_SIZE, maps?: GameMap[]): StageSpec[] {
  return attempt(() => engineSuggestFormat({ totalTeams, lobbySize, maps })) ?? localSuggest(totalTeams, lobbySize, maps);
}

/** Local stand-in for validateFormat — the basic rules only. */
function localValidate(stages: StageSpec[], maxTeams: number): FormatIssue[] {
  const out: FormatIssue[] = [];
  if (!stages.length) return [{ stage: null, level: "error", message: "Add at least one stage." }];
  if (stages[0]!.teamsIn !== maxTeams)
    out.push({ stage: 0, level: "error", message: `The first stage must take all ${maxTeams} teams.` });
  stages.forEach((s, i) => {
    const last = i === stages.length - 1;
    if (s.lobbySize > 25) out.push({ stage: i, level: "error", message: "A lobby can hold at most 25 teams." });
    if (s.maps.length !== s.matchesPerGroup) out.push({ stage: i, level: "error", message: "Pick one map for every match." });
    if (s.groupCount * s.lobbySize < s.teamsIn)
      out.push({ stage: i, level: "error", message: `${s.teamsIn} teams don't fit in ${s.groupCount} lobbies of ${s.lobbySize}.` });
    const smallest = Math.floor(s.teamsIn / Math.max(1, s.groupCount));
    if (!last && s.advancePerGroup >= smallest)
      out.push({ stage: i, level: "error", message: `Top ${s.advancePerGroup} can't advance from groups of ${smallest} — someone has to go out.` });
    if (!last && s.advancePerGroup === 0 && s.wildcardCount === 0) out.push({ stage: i, level: "error", message: "Nobody advances from this stage." });
    if (i > 0) {
      const flow = teamsOut(stages[i - 1]!, false) + s.invitedSlots;
      if (flow !== s.teamsIn) out.push({ stage: i, level: "error", message: `${flow} teams arrive from the previous stage, but this stage expects ${s.teamsIn}.` });
    }
    if (last && s.groupCount > 1) out.push({ stage: i, level: "warning", message: "The final usually has a single lobby so there's one champion." });
  });
  return out;
}

export function validateFormat(stages: StageSpec[], maxTeams: number): FormatIssue[] {
  return attempt(() => engineValidateFormat(stages, maxTeams)) ?? localValidate(stages, maxTeams);
}

/** Schedule preview; `null` while the engine isn't available (show a placeholder). */
export function planSchedule(config: ScheduleConfig | null, stage: StageSpec): SchedulePlan | null {
  if (!config) return null;
  return attempt(() => enginePlanSchedule(config, groupSizes(stage.teamsIn, stage.groupCount), stage.matchesPerGroup, stage.maps));
}

/**
 * Keep a format consistent after an edit: stage 1 takes all teams, every later stage takes what the previous stage
 * sends + its invited slots, enough lobbies exist, matches = maps, and the last stage advances nobody.
 */
export function normalizeStages(stages: StageSpec[], maxTeams: number): StageSpec[] {
  const out: StageSpec[] = [];
  stages.forEach((s, i) => {
    const last = i === stages.length - 1;
    const teamsIn = i === 0 ? maxTeams : teamsOut(out[i - 1]!, false) + s.invitedSlots;
    const lobbySize = Math.min(25, Math.max(2, s.lobbySize));
    const minGroups = Math.max(1, Math.ceil(teamsIn / lobbySize));
    const maxGroups = Math.max(minGroups, Math.floor(teamsIn / 2));
    const groupCount = Math.min(maxGroups, Math.max(minGroups, s.groupCount));
    out.push({
      ...s,
      teamsIn,
      lobbySize,
      groupCount,
      matchesPerGroup: s.maps.length || s.matchesPerGroup,
      invitedSlots: i === 0 ? 0 : s.invitedSlots,
      advancePerGroup: last ? 0 : s.advancePerGroup,
      wildcardCount: last ? 0 : s.wildcardCount,
    });
  });
  return out;
}

/** A schedule for `stage` starting on `startDate` whose end date is just long enough to fit every group. */
export function fittingSchedule(stage: StageSpec, startDate: string, base: Omit<ScheduleConfig, "startDate" | "endDate">): ScheduleConfig {
  const cfg: ScheduleConfig = { ...base, windows: base.windows.map((w) => ({ ...w })), startDate, endDate: addDays(startDate, 60) };
  const plan = planSchedule(cfg, stage);
  const last = plan?.blocks.reduce((d, b) => (b.date > d ? b.date : d), startDate);
  return { ...cfg, endDate: last ?? addDays(startDate, 2) };
}

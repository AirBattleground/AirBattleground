/** Format helpers: group sizes, names, flow rule, presets and validation. */
import { MAX_ROOM_SLOTS, type GameMap } from "../enums";
import { DEFAULT_LOBBY_SIZE, type FormatIssue, type StageSpec } from "../phase3";

export const DEFAULT_MAP_CYCLE: GameMap[] = ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL", "VIKENDI", "MIRAMAR"];

/** teamsOut = groupCount × advancePerGroup + wildcardCount (0 for the last stage). */
export function teamsOut(stage: StageSpec, isLast: boolean): number {
  if (isLast) return 0;
  return stage.groupCount * stage.advancePerGroup + stage.wildcardCount;
}

/** Balanced group sizes: length = groups, sum = teams, max − min ≤ 1, larger groups first. */
export function groupSizes(teams: number, groups: number): number[] {
  const g = Math.floor(groups);
  const t = Math.max(0, Math.floor(teams));
  if (!(g > 0)) return [];
  const base = Math.floor(t / g);
  const extra = t % g;
  return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "A".."Z", then "AA", "AB", … */
export function groupName(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function mapsFor(count: number, maps?: GameMap[]): GameMap[] {
  const cycle = maps && maps.length > 0 ? maps : DEFAULT_MAP_CYCLE;
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]!);
}

function stageNames(count: number): string[] {
  if (count === 1) return ["Final"];
  return Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return "Final";
    if (i === 0) return "Qualifier";
    if (i === count - 2) return "Semi-final";
    if (i === count - 3) return "Quarter-final";
    return `Round ${i}`;
  });
}

function matchesFor(name: string): number {
  if (name === "Qualifier" || name.startsWith("Round ")) return 4;
  return 6;
}

/** Group count of the stage after a stage with `g` groups of lobby `L` (1 = final). */
function nextGroupCount(g: number, L: number): number {
  if (g <= Math.min(4, L)) return 1;
  if (g <= Math.min(8, 2 * L)) return 2;
  return Math.max(Math.ceil(g / 4), Math.ceil(g / L), Math.min(5, g - 1));
}

/** Stage presets for the wizard. Must return a format that passes validateFormat with no errors. */
export function suggestFormat(input: { totalTeams: number; lobbySize?: number; maps?: GameMap[] }): StageSpec[] {
  const L = Math.max(2, Math.floor(input.lobbySize ?? DEFAULT_LOBBY_SIZE));
  const total = Math.max(2, Math.floor(input.totalTeams));

  // Build the chain of (teamsIn, groupCount, advance, wildcards).
  const chain: { teamsIn: number; groupCount: number; advance: number; wildcards: number }[] = [];
  let n = total;
  while (n > L) {
    const g = Math.ceil(n / L);
    const g2 = nextGroupCount(g, L);
    const target = g2 * L; // next stage fills its lobbies
    const minSize = Math.floor(n / g);
    let a = Math.floor(target / g);
    // keep at least one team eliminated per group when possible (no "nobody eliminated" warning)
    if (a >= minSize && minSize > 1) a = minSize - 1;
    const w = target - g * a;
    chain.push({ teamsIn: n, groupCount: g, advance: a, wildcards: w });
    n = target;
  }
  chain.push({ teamsIn: n, groupCount: 1, advance: 0, wildcards: 0 });

  const names = stageNames(chain.length);
  return chain.map((c, i) => {
    const name = names[i]!;
    const matches = matchesFor(name);
    return {
      name,
      teamsIn: c.teamsIn,
      lobbySize: L,
      groupCount: c.groupCount,
      matchesPerGroup: matches,
      maps: mapsFor(matches, input.maps),
      advancePerGroup: c.advance,
      wildcardCount: c.wildcards,
      invitedSlots: 0,
      schedule: null,
    };
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Checks the flow rule and sanity rules; errors block publishing, warnings don't. */
export function validateFormat(stages: StageSpec[], maxTeams: number): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const err = (stage: number | null, message: string) => issues.push({ stage, level: "error", message });
  const warn = (stage: number | null, message: string) => issues.push({ stage, level: "warning", message });

  if (stages.length === 0) {
    err(null, "Add at least one stage.");
    return issues;
  }

  stages.forEach((s, i) => {
    const isLast = i === stages.length - 1;
    const name = s.name || `Stage ${i + 1}`;

    if (i === 0 && s.teamsIn !== maxTeams) {
      err(i, `${name} is set for ${plural(s.teamsIn, "team")} but the tournament takes ${plural(maxTeams, "team")}.`);
    }
    if (i === 0 && s.invitedSlots > 0) {
      err(i, `${name} is the first stage, so it can't have invited teams. Invite teams into a later stage instead.`);
    }
    if (i > 0) {
      const prev = stages[i - 1]!;
      const prevName = prev.name || `Stage ${i}`;
      const sends = teamsOut(prev, false);
      const expected = sends + s.invitedSlots;
      if (expected !== s.teamsIn) {
        const detail = `${plural(prev.groupCount, "group")} × top ${prev.advancePerGroup}${
          prev.wildcardCount > 0 ? ` + ${plural(prev.wildcardCount, "wildcard")}` : ""
        }`;
        const invited = s.invitedSlots > 0 ? `, plus ${plural(s.invitedSlots, "invited team")} makes ${expected}` : "";
        err(i, `${name} expects ${plural(s.teamsIn, "team")} but the ${prevName} sends ${sends} (${detail})${invited}.`);
      }
    }

    if (s.lobbySize > MAX_ROOM_SLOTS) err(i, `${name}: a lobby holds at most ${MAX_ROOM_SLOTS} teams (you set ${s.lobbySize}).`);
    if (s.lobbySize < 2) err(i, `${name}: a lobby needs room for at least 2 teams.`);

    if (s.groupCount < 1) {
      err(i, `${name} needs at least 1 group.`);
    } else {
      if (s.groupCount * s.lobbySize < s.teamsIn) {
        err(
          i,
          `${name} has ${plural(s.teamsIn, "team")} but only room for ${s.groupCount * s.lobbySize} (${plural(s.groupCount, "group")} × ${s.lobbySize}). Add groups or raise the lobby size.`,
        );
      }
      if (s.groupCount > s.teamsIn) {
        err(i, `${name} has more groups (${s.groupCount}) than teams (${s.teamsIn}). Use fewer groups.`);
      }
    }

    if (s.maps.length !== s.matchesPerGroup) {
      err(i, `${name} plays ${plural(s.matchesPerGroup, "match", "matches")} per group but has ${plural(s.maps.length, "map")}. Pick one map per match.`);
    }

    const sizes = groupSizes(s.teamsIn, Math.max(1, s.groupCount));
    const minSize = sizes.length ? sizes[sizes.length - 1]! : 0;

    if (isLast) {
      if (s.advancePerGroup > 0 || s.wildcardCount > 0) {
        err(i, `${name} is the last stage, so no teams can advance from it (set top teams and wildcards to 0).`);
      }
      if (s.groupCount > 1) {
        warn(i, `${name} has ${s.groupCount} groups. A final is usually one lobby so there is a single champion.`);
      }
    } else {
      if (s.advancePerGroup > minSize) {
        err(i, `${name}: top ${s.advancePerGroup} can't advance from groups of only ${minSize} teams.`);
      } else if (s.advancePerGroup > 0 && s.advancePerGroup >= minSize) {
        warn(i, `${name}: every team in a group of ${minSize} advances, so nobody is eliminated there.`);
      }
      const pool = sizes.reduce((sum, sz) => sum + Math.max(0, sz - s.advancePerGroup), 0);
      if (s.wildcardCount > pool) {
        err(i, `${name} has ${plural(s.wildcardCount, "wildcard")} but only ${plural(pool, "team")} miss out on the top ${s.advancePerGroup}.`);
      }
    }

    if (s.groupCount > 1 && minSize > 0 && minSize < s.lobbySize / 2) {
      warn(i, `${name}: groups of ${minSize} fill less than half a ${s.lobbySize}-team lobby. Consider fewer groups.`);
    }

    if (i === 0 && !s.schedule) warn(i, `${name} has no schedule yet. Set dates and times before publishing.`);
  });

  return issues;
}

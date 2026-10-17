/** Stage-1 draw (time preferences, first come first served) and snake seeding for later stages. */
import { createRng, randInt, shuffle } from "./rng";
import type { DrawGroup, DrawResult, DrawTeam } from "./types";

function slotNumbersFor(rng: () => number, size: number, count: number, firstSlot: number): number[] {
  const n = Math.max(size, count);
  return shuffle(
    rng,
    Array.from({ length: n }, (_, i) => firstSlot + i),
  ).slice(0, count);
}

/**
 * Stage-1 draw. Teams in the given order (registration order = first come first served) take their highest-ranked
 * preference slot that still has capacity (random group within that slot via rng); teams with no satisfiable
 * preference (or none given) are placed randomly into remaining space after preference holders. Slot numbers in each
 * group are a seeded shuffle of firstSlot..firstSlot+size-1. `seed` in the result = draw order (1-based).
 *
 * `seed` per team = its 1-based position in `teams`. `unmet` lists teams that gave preferences but got none of them.
 * Throws if there are more teams than group space.
 */
export function drawGroups(teams: DrawTeam[], groups: DrawGroup[], seed: string, firstSlot: number): DrawResult {
  const capacity = groups.reduce((s, g) => s + Math.max(0, g.size), 0);
  if (teams.length > capacity) {
    throw new Error(`Can't draw ${teams.length} teams into groups with room for ${capacity}.`);
  }
  const rng = createRng(seed);
  const members = new Map<number, number[]>(); // group index (position in `groups`) → team positions
  groups.forEach((_, i) => members.set(i, []));
  const free = (gi: number) => groups[gi]!.size - members.get(gi)!.length;

  const bySlot = new Map<string, number[]>();
  groups.forEach((g, i) => {
    if (g.slotId == null) return;
    const list = bySlot.get(g.slotId) ?? [];
    list.push(i);
    bySlot.set(g.slotId, list);
  });

  const assigned = new Array<number>(teams.length).fill(-1);
  const leftovers: number[] = [];

  teams.forEach((t, ti) => {
    for (const pref of t.preferences) {
      const candidates = (bySlot.get(pref) ?? []).filter((gi) => free(gi) > 0);
      if (candidates.length === 0) continue;
      const gi = candidates[randInt(rng, candidates.length)]!;
      members.get(gi)!.push(ti);
      assigned[ti] = gi;
      return;
    }
    leftovers.push(ti);
  });

  for (const ti of leftovers) {
    // random free seat (groups weighted by remaining space)
    const totalFree = groups.reduce((s, _, gi) => s + Math.max(0, free(gi)), 0);
    let pick = randInt(rng, totalFree);
    let gi = 0;
    for (; gi < groups.length; gi++) {
      const f = Math.max(0, free(gi));
      if (pick < f) break;
      pick -= f;
    }
    members.get(gi)!.push(ti);
    assigned[ti] = gi;
  }

  const result: DrawResult = { groups: [], unmet: [] };
  groups.forEach((g, gi) => {
    const tis = members.get(gi)!.slice().sort((a, b) => a - b);
    const slots = slotNumbersFor(rng, g.size, tis.length, firstSlot);
    result.groups.push({
      index: g.index,
      teams: tis.map((ti, k) => ({ teamId: teams[ti]!.teamId, slotNumber: slots[k]!, seed: ti + 1 })),
    });
  });

  teams.forEach((t, ti) => {
    if (t.preferences.length === 0) return;
    const got = groups[assigned[ti]!]?.slotId ?? null;
    if (got == null || !t.preferences.includes(got)) result.unmet.push({ teamId: t.teamId, wanted: t.preferences.slice(), got });
  });
  return result;
}

/**
 * Snake seeding into groups of the given sizes: seeds (already ranked best-first) go A,B,C,…, then back …,C,B,A.
 * Slot numbers = seeded shuffle of firstSlot.. within each group. Group `index` = position in `sizes`;
 * `seed` = 1-based position in `rankedTeamIds`. Throws if there are more teams than space.
 */
export function snakeSeed(rankedTeamIds: string[], sizes: number[], seed: string, firstSlot: number): DrawResult["groups"] {
  const capacity = sizes.reduce((s, n) => s + Math.max(0, n), 0);
  if (rankedTeamIds.length > capacity) {
    throw new Error(`Can't seed ${rankedTeamIds.length} teams into groups with room for ${capacity}.`);
  }
  const members: number[][] = sizes.map(() => []);
  let next = 0;
  const maxSize = Math.max(0, ...sizes);
  for (let row = 0; row < maxSize && next < rankedTeamIds.length; row++) {
    const order = sizes.map((_, i) => i).filter((i) => sizes[i]! > row);
    if (row % 2 === 1) order.reverse();
    for (const gi of order) {
      if (next >= rankedTeamIds.length) break;
      members[gi]!.push(next++);
    }
  }
  const rng = createRng(seed);
  return sizes.map((size, gi) => {
    const tis = members[gi]!;
    const slots = slotNumbersFor(rng, size, tis.length, firstSlot);
    return { index: gi, teams: tis.map((ti, k) => ({ teamId: rankedTeamIds[ti]!, slotNumber: slots[k]!, seed: ti + 1 })) };
  });
}

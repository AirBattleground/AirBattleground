/**
 * Pure tournament algorithms — no I/O, deterministic for a given seed. Used by the API (authoritative) and by
 * the UIs (live previews in the wizard). Spec: docs/phase3/TOURNAMENTS.md "Algorithms".
 * Times are IST; dates "YYYY-MM-DD"; instants are ISO strings with +05:30 offset.
 *
 * Implementations live in sibling files; this module is the public surface.
 *   format.ts    suggestFormat, suggestRounds, defaultStageName/Maps, validateFormat, teamsOut, groupSizes, groupName
 *   plan.ts      planSchedule
 *   rng.ts       createRng
 *   draw.ts      drawGroups, snakeSeed
 *   promotion.ts rankStage, promote, nextStageSeeds
 */
export { suggestFormat, suggestRounds, defaultStageName, defaultStageMaps, validateFormat, teamsOut, groupSizes, groupName } from "./format";
export { planSchedule } from "./plan";
export { createRng } from "./rng";
export { drawGroups, snakeSeed } from "./draw";
export { rankStage, promote, nextStageSeeds } from "./promotion";
export * from "./tdm";
export type { DrawTeam, DrawGroup, DrawResult, GroupResults, RankedTeam, PromotionResult } from "./types";

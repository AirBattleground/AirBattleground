import { describe, expect, it } from "vitest";
import type { ExtractedPlayer, ExtractionResult } from "@7xen/shared";
import { mergeResults, mergeSlotList, nameSimilarity, type DraftTeam } from "../src/services/merge.js";
import { toExtractionResult } from "../src/lib/extractor.js";

const pl = (name: string, extra: Partial<ExtractedPlayer> = {}): ExtractedPlayer => ({
  name,
  confidence: 0.95,
  source: "paddle",
  rosterMatch: null,
  matchedSlot: null,
  kills: null,
  killsConfidence: null,
  ...extra,
});

const base = (kind: ExtractionResult["kind"]): ExtractionResult => ({
  imageId: "img",
  kind,
  modelVersion: "v1",
  teams: [],
  rows: [],
  needsReview: false,
  warnings: [],
  timingsMs: {},
});

const lineup = (): DraftTeam[] => [
  {
    slotNumber: 5,
    teamId: "tA",
    placement: null,
    kills: null,
    players: ["A9xTARUN", "A9xRolf", "AExVENOMM", "RexxyyThePapa"].map((name, i) => ({ position: i + 1, name, ocrName: name, ocrConfidence: 0.9, kills: null })),
  },
  {
    slotNumber: 7,
    teamId: "tB",
    placement: null,
    kills: null,
    players: ["GExRuwad1O", "GExDeadPlaYeR", "GExMoOnGOD", "GExFireGod"].map((name, i) => ({ position: i + 1, name, ocrName: name, ocrConfidence: 0.9, kills: null })),
  },
];
const ctx = { slotToTeam: new Map([[5, "tA"], [7, "tB"]]) };

describe("name matching", () => {
  it("folds lookalikes and spacing", () => {
    expect(nameSimilarity("GExRuwad1O", "GExRuwadlO")).toBe(1);
    expect(nameSimilarity("WRG | GHOST", "WRGGHOST")).toBe(1);
    expect(nameSimilarity("abc", "xyz")).toBeLessThan(0.5);
  });
});

describe("mergeSlotList", () => {
  it("creates teams per slot with roster-matched names and team ids", () => {
    const ex = base("SLOT_LIST");
    ex.teams = [
      { slot: 5, slotConfidence: 0.99, players: [pl("A9xTARUN"), pl("A9xRo1f", { rosterMatch: "A9xRolf", confidence: 0.7 })] },
      { slot: 10, slotConfidence: 0.9, players: [pl("Ghost")] },
      { slot: null, slotConfidence: 0.1, players: [pl("Lost1"), pl("Lost2")] },
    ];
    const out = mergeSlotList([], ex, ctx);
    expect(out.teams.map((t) => t.slotNumber)).toEqual([5, 10]);
    expect(out.teams[0]!.teamId).toBe("tA");
    expect(out.teams[0]!.players[1]).toMatchObject({ position: 2, name: "A9xRolf", ocrName: "A9xRo1f", ocrConfidence: 0.7 });
    expect(out.teams[1]!.teamId).toBeNull();
    expect(out.warnings).toEqual([expect.stringContaining("Couldn't read the slot number")]);
  });

  it("uses the players' matched slot when the slot digits are unreadable", () => {
    const ex = base("SLOT_LIST");
    ex.teams = [{ slot: null, slotConfidence: 0, players: [pl("x", { matchedSlot: 7 }), pl("y", { matchedSlot: 7 }), pl("z", { matchedSlot: 5 })] }];
    expect(mergeSlotList([], ex, ctx).teams[0]!.slotNumber).toBe(7);
  });

  it("never changes a confirmed lineup", () => {
    const ex = base("SLOT_LIST");
    ex.teams = [{ slot: 5, slotConfidence: 1, players: [pl("Someone")] }];
    const out = mergeSlotList(lineup(), ex, { ...ctx, lineupLocked: true });
    expect(out.changedSlots.size).toBe(0);
    expect(out.teams[0]!.players[0]!.name).toBe("A9xTARUN");
    expect(out.warnings[0]).toMatch(/already confirmed/);
  });
});

describe("mergeResults", () => {
  const resultsShot = () => {
    const ex = base("RESULTS");
    ex.rows = [
      // rank 1: inferred by the extractor
      { rank: 1, rankConfidence: 0.99, inferredSlot: 7, players: [pl("GExRuwad1O", { kills: 5 }), pl("GExDeadPlaYeR", { kills: 5 }), pl("GExMoOnG0D", { kills: 1 }), pl("GExFireGod", { kills: 2 })] },
      // rank 2: no inferred slot → our fuzzy match against the lineup
      { rank: 2, rankConfidence: 0.95, inferredSlot: null, players: [pl("A9xTARUN", { kills: 3 }), pl("A9xRoIf", { kills: 1 }), pl("AExVENOMM", { kills: 0 }), pl("RexxyyThePapa", { kills: 2 })] },
      // unknown team
      { rank: 3, rankConfidence: 0.9, inferredSlot: null, players: [pl("Nobody", { kills: 1 }), pl("Stranger", { kills: 0 })] },
    ];
    return ex;
  };

  it("sets placement = rank, player kills by name, team kills = sum; unmapped rows → warnings", () => {
    const out = mergeResults(lineup(), resultsShot(), ctx);
    const s7 = out.teams.find((t) => t.slotNumber === 7)!;
    const s5 = out.teams.find((t) => t.slotNumber === 5)!;
    expect(s7).toMatchObject({ placement: 1, kills: 13 });
    expect(s7.players.map((p) => p.kills)).toEqual([5, 5, 1, 2]);
    expect(s7.players.map((p) => p.name)).toContain("GExMoOnGOD"); // lineup name kept
    expect(s5).toMatchObject({ placement: 2, kills: 6 });
    expect(s5.players.find((p) => p.name === "A9xRolf")!.kills).toBe(1);
    expect(out.warnings).toEqual([expect.stringMatching(/Couldn't match rank 3 .*Nobody, Stranger/)]);
  });

  it("dedupes ranks repeated across screenshots (no double counting)", () => {
    const first = mergeResults(lineup(), resultsShot(), ctx);
    const second = base("RESULTS");
    // ranks 1-2 again (pinned panel), and rank 2 read twice on the same image
    second.rows = [resultsShot().rows[0]!, resultsShot().rows[1]!, { ...resultsShot().rows[1]!, players: [pl("A9xTARUN", { kills: 3 })] }];
    const out = mergeResults(first.teams, second, ctx);
    expect(out.warnings).toEqual([]);
    expect(out.teams.find((t) => t.slotNumber === 7)).toMatchObject({ placement: 1, kills: 13 });
    expect(out.teams.find((t) => t.slotNumber === 5)).toMatchObject({ placement: 2, kills: 6 });
  });

  it("warns when the same rank is read for two different teams", () => {
    const first = mergeResults(lineup(), resultsShot(), ctx);
    const clash = base("RESULTS");
    clash.rows = [{ rank: 1, rankConfidence: 0.5, inferredSlot: 5, players: [pl("A9xTARUN", { kills: 3 })] }];
    const out = mergeResults(first.teams, clash, ctx);
    expect(out.warnings.join(" ")).toMatch(/Rank 1 was read for both slot 7 and slot 5/);
  });

  it("does nothing once published", () => {
    const out = mergeResults(lineup(), resultsShot(), { ...ctx, resultsLocked: true });
    expect(out.changedSlots.size).toBe(0);
  });
});

describe("extractor mapping", () => {
  it("converts snake_case to the shared camelCase shape", () => {
    const r = toExtractionResult(
      {
        image_id: "x",
        kind: "results",
        model_version: "v2",
        rows: [{ rank: 4, rank_confidence: 0.8, inferred_slot: 5, players: [{ name: "a", confidence: 0.9, roster_match: "A", matched_slot: 5, kills: 2, kills_confidence: 0.7 }] }],
        needs_review: true,
        warnings: ["w"],
        timings_ms: { ocr: 12.5 },
      },
      "SLOT_LIST",
    );
    expect(r).toEqual({
      imageId: "x",
      kind: "RESULTS",
      modelVersion: "v2",
      teams: [],
      rows: [{ rank: 4, rankConfidence: 0.8, inferredSlot: 5, players: [{ name: "a", confidence: 0.9, source: "paddle", rosterMatch: "A", matchedSlot: 5, kills: 2, killsConfidence: 0.7 }] }],
      needsReview: true,
      warnings: ["w"],
      timingsMs: { ocr: 12.5 },
    });
  });
});

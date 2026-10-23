/** Live team status: how a capture's per-team counts land on players (pure; no database). */
import { describe, expect, it } from "vitest";
import { matchReadTeam, reconcileTeam, type SlotTeam, type StoredPlayer } from "../src/services/liveStatus.js";

const now = new Date("2026-10-23T14:05:00.000Z");
const states = (ps: StoredPlayer[]) => ps.map((p) => p.state);
const alive = (): StoredPlayer => ({ state: "alive" });

describe("reconcileTeam", () => {
  it("knocks and eliminates the last players first; knocked go out before alive ones", () => {
    const a = reconcileTeam([], 4, ["alive", "alive", "alive", "knocked"], now);
    expect(states(a.players)).toEqual(["alive", "alive", "alive", "knocked"]);
    expect(a.changed).toBe(1);
    const b = reconcileTeam(a.players, 4, ["alive", "alive", "alive", "eliminated"], now);
    expect(states(b.players)).toEqual(["alive", "alive", "alive", "eliminated"]);
    expect(b.players[3]).toEqual({ state: "eliminated", source: "auto", at: now.toISOString() });
  });

  it("revives knocked players but never eliminated ones", () => {
    const cur: StoredPlayer[] = [alive(), { state: "knocked" }, alive(), { state: "eliminated" }];
    const r = reconcileTeam(cur, 4, ["alive", "alive", "alive", "alive"], now);
    expect(states(r.players)).toEqual(["alive", "alive", "alive", "eliminated"]);
    expect(r.changed).toBe(1);
  });

  it("skips players a manager changed in the last 60 s", () => {
    const fresh: StoredPlayer = { state: "alive", source: "manager", at: new Date(now.getTime() - 30_000).toISOString() };
    const stale: StoredPlayer = { state: "alive", source: "manager", at: new Date(now.getTime() - 90_000).toISOString() };
    const r = reconcileTeam([alive(), alive(), stale, fresh], 4, ["eliminated", "eliminated", "alive", "alive"], now);
    expect(states(r.players)).toEqual(["alive", "eliminated", "eliminated", "alive"]);
    expect(r.players[3]).toEqual(fresh);
  });

  it("fits a team with fewer players than bars", () => {
    const r = reconcileTeam([], 2, ["eliminated", "eliminated", "eliminated", "alive"], now);
    expect(states(r.players)).toEqual(["eliminated", "eliminated"]);
  });
});

describe("matchReadTeam", () => {
  const slot = (slotNumber: number, name: string, tag: string) => ({ slotNumber, team: { id: name, name, tag, logoKey: null, members: [] } }) as SlotTeam;
  const slots = [slot(3, "SOUL", "SOUL"), slot(4, "Team 8Bit", "8BIT"), slot(5, "GodLike Esports", "GODL")];

  it("matches by slot first, then name or tag ignoring case and symbols", () => {
    expect(matchReadTeam({ slot: 4, name: "SOUL" }, slots)?.slotNumber).toBe(4);
    expect(matchReadTeam({ slot: 99, name: "soul" }, slots)?.slotNumber).toBe(3);
    expect(matchReadTeam({ slot: null, name: "8bit" }, slots)?.slotNumber).toBe(4);
    expect(matchReadTeam({ slot: null, name: "team-8bit" }, slots)?.slotNumber).toBe(4);
    expect(matchReadTeam({ slot: null, name: "GodLike" }, slots)?.slotNumber).toBe(5);
  });

  it("gives up when nothing or more than one team matches", () => {
    expect(matchReadTeam({ slot: null, name: "Blind" }, slots)).toBeNull();
    expect(matchReadTeam({ slot: null, name: null }, slots)).toBeNull();
    expect(matchReadTeam({ slot: null, name: "team" }, [slot(1, "Team A1", "A"), slot(2, "Team B2", "B")])).toBeNull();
  });
});

describe("toLiveReadResult", () => {
  it("keeps valid states (max 4), maps unsure to low confidence, unknown screens to other", async () => {
    const { toLiveReadResult } = await import("../src/lib/extractor.js");
    const r = toLiveReadResult(
      {
        screen: "spectator_hud",
        teams: [
          { slot: 3, name: " SOUL ", players: ["alive", "dead", "knocked", "eliminated", "alive", "alive"], unsure: false },
          { slot: null, name: "", players: ["alive"], unsure: true },
        ],
        warnings: ["", "blurry"],
      },
      "m",
    );
    expect(r.teams).toEqual([
      { slot: 3, name: "SOUL", players: ["alive", "knocked", "eliminated", "alive"], confidence: 0.97 },
      { slot: null, name: null, players: ["alive"], confidence: 0.6 },
    ]);
    expect(r.warnings).toEqual(["blurry"]);
    expect(toLiveReadResult({ screen: "lobby" }, "m")).toMatchObject({ screen: "other", teams: [] });
  });
});

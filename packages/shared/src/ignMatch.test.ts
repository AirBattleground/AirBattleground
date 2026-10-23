import { describe, expect, it } from "vitest";
import { ignSimilarity, matchIgn, normalizeIgn } from "./ignMatch";

const roster = [{ ign: "PHX•Blaze" }, { ign: "PHX•Viper" }, { ign: "PHX•Ronin" }, { ign: "PHX•Ace" }];

describe("ign matching", () => {
  it("normalises case, spaces, separators and OCR lookalikes", () => {
    expect(normalizeIgn("PHX•Blaze")).toBe(normalizeIgn("phx · blaze"));
    expect(normalizeIgn("PHX•Blaze")).toBe(normalizeIgn("PHX|B1aze"));
    expect(normalizeIgn("SOUL乡Mortal")).toBe("soul乡mortal");
    expect(normalizeIgn("Hornet")).toBe(normalizeIgn("Homet"));
    expect(normalizeIgn("G0D")).toBe(normalizeIgn("GOD"));
  });

  it("links the one roster name that matches", () => {
    expect(matchIgn("PHX·Blaze", roster)?.ign).toBe("PHX•Blaze");
    expect(matchIgn("phx•r0nin", roster)?.ign).toBe("PHX•Ronin");
    expect(matchIgn("PHX•B1aze", roster)?.ign).toBe("PHX•Blaze");
  });

  it("leaves different names unknown — short names need a near-exact read", () => {
    expect(matchIgn("UNKNOWN", roster)).toBeNull();
    expect(matchIgn("PHX•Blaz", roster)).toBeNull();
    expect(matchIgn("PHX•Blaxe", roster)).toBeNull();
    expect(matchIgn("", roster)).toBeNull();
    expect(ignSimilarity("PHX•Blaze", "PHX•Blaxe")).toBeLessThan(0.95);
  });

  it("allows one wrong letter in a long name", () => {
    expect(matchIgn("ThunderStrikeLegendX7Pro", [{ ign: "ThunderStrikeLegendX7Pr0" }])).not.toBeNull();
    expect(ignSimilarity("ThunderStrikeLegendX7Pro", "ThunderStrikeLegendX7Prq")).toBeGreaterThanOrEqual(0.95);
  });

  it("never guesses between two names that both match", () => {
    expect(matchIgn("PHX•Ace", [{ ign: "PHX•Ace" }, { ign: "phx ace" }])).toBeNull();
  });
});

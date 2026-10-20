import { describe, expect, it } from "vitest";
import { DEFAULT_YOUTUBE_TITLE, youtubeTitle } from "./youtube";

const v = { org: "Opus Esports", event: "Winter Cup", details: "Semi-finals · Group A · Match 1", map: "TDM · Warehouse" };

describe("youtubeTitle", () => {
  it("fills the default template", () => {
    expect(youtubeTitle(DEFAULT_YOUTUBE_TITLE, v)).toBe("Opus Esports · Winter Cup · Semi-finals · Group A · Match 1 · TDM · Warehouse");
  });
  it("keeps to 100 characters, drops angle brackets, falls back to the event", () => {
    expect(youtubeTitle("{event} ".repeat(30), v).length).toBe(100);
    expect(youtubeTitle("<b>{org}</b>", v)).toBe("bOpus Esports/b");
    expect(youtubeTitle("   ", v)).toBe("Winter Cup");
  });
});

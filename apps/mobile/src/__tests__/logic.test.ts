import type { AppRelease, Recipe } from "@7xen/shared";
import { RecordingEventQueue } from "@/lib/eventQueue";
import { needsAutomation, pickRecipe } from "@/lib/recipes";
import { isUpdateAvailable } from "@/lib/update";

describe("RecordingEventQueue", () => {
  const clock = () => new Date("2026-10-17T10:00:00Z");
  it("batches events and sends extra fields", async () => {
    const send = jest.fn().mockResolvedValue({});
    const q = new RecordingEventQueue("r1", send, clock);
    q.push("start", "Assisted");
    q.push("capture", "SLOT_LIST auto");
    expect(await q.flush({ status: "LIVE" })).toBe(true);
    expect(send).toHaveBeenCalledWith("r1", {
      status: "LIVE",
      events: [
        { at: "2026-10-17T10:00:00.000Z", type: "start", detail: "Assisted" },
        { at: "2026-10-17T10:00:00.000Z", type: "capture", detail: "SLOT_LIST auto" },
      ],
    });
    expect(q.size).toBe(0);
    expect(await q.flush()).toBe(true); // nothing to send
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps events when sending fails and retries later", async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const q = new RecordingEventQueue("r1", send, clock);
    q.push("pause");
    expect(await q.flush()).toBe(false);
    expect(q.size).toBe(1);
    q.push("resume");
    expect(await q.flush()).toBe(true);
    expect(send.mock.calls[1][1].events.map((e: { type: string }) => e.type)).toEqual(["pause", "resume"]);
  });
  it("sends at most 200 events per request", async () => {
    const send = jest.fn().mockResolvedValue({});
    const q = new RecordingEventQueue("r1", send, clock);
    for (let i = 0; i < 250; i++) q.push("screen", `s${i}`);
    await q.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1].events).toHaveLength(200);
    expect(send.mock.calls[1][1].events).toHaveLength(50);
  });
  it("trims long details to 300 chars", () => {
    const send = jest.fn().mockResolvedValue({});
    const q = new RecordingEventQueue("r1", send, clock);
    q.push("error", "x".repeat(500));
    return q.flush().then(() => expect(send.mock.calls[0][1].events[0].detail).toHaveLength(300));
  });
});

const recipe = (p: Partial<Recipe>): Recipe => ({ id: "x", key: "CREATE_ROOM", name: "n", version: 1, scope: "DEFAULT", deviceProfile: null, steps: [], updatedAt: "", ...p });
describe("recipes", () => {
  it("prefers the manager's taught recipe, newest version", () => {
    const list = [recipe({ id: "d1", version: 3 }), recipe({ id: "m1", scope: "MANAGER", version: 1 }), recipe({ id: "m2", scope: "MANAGER", version: 2 }), recipe({ id: "o", key: "SCROLL_RESULTS", scope: "MANAGER" })];
    expect(pickRecipe(list, "CREATE_ROOM")?.id).toBe("m2");
    expect(pickRecipe([recipe({ id: "d1" })], "CREATE_ROOM")?.id).toBe("d1");
    expect(pickRecipe([], "CREATE_ROOM")).toBeNull();
  });
  it("knows when Auto mode needs accessibility", () => {
    expect(needsAutomation(recipe({ steps: [{ id: "a", label: "x", action: { type: "manual" }, timeoutMs: 1000 }] }))).toBe(false);
    expect(needsAutomation(recipe({ steps: [{ id: "a", label: "x", action: { type: "tap", x: 0.1, y: 0.2 }, timeoutMs: 1000 }] }))).toBe(true);
  });
});

describe("update check", () => {
  const rel = (versionCode: number): AppRelease => ({ version: "1.0.1", versionCode, url: "/api/app/manager/download", sizeBytes: 1, notes: null, publishedAt: "" });
  it("compares version codes", () => {
    expect(isUpdateAvailable(null, 1)).toBe(false);
    expect(isUpdateAvailable(rel(1), 1)).toBe(false);
    expect(isUpdateAvailable(rel(2), 1)).toBe(true);
  });
});
